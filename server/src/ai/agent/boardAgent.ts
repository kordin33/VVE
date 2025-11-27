import type {
    ChatCompletionMessageParam,
    ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { llmClient, BOARD_AI_MODEL } from '../provider/llmClient';
import { BoardDoc } from '../../yjs/boardDoc';
import { BoardSnapshot, BoardPatch, BoardObject } from '../../models/boardSnapshot';
import { boardToolsSchema } from './boardToolsSchema';
import {
    toolAlignSelectionToGrid,
    toolGenerateDiagramFromPrompt,
    toolSimplifyEquationBlock,
    toolDrawBoardPatch,
    toolInsertLatexBox,
    toolTextBlockToLatexUpdate,
    toolPlotFunction,
    toolConnectObjects,
    toolLabelObject,
    toolSetStyle,
    toolDeleteObjects,
} from '../tools/boardTools';
import { retrieveBoardDocs } from '../docs/boardCapabilities';
import { buildAgentBoardContext } from './boardAgentContext';

if (!llmClient) {
    console.warn('[AI] Board Assistant disabled – no LLM client configured');
}

type AgentResult = {
    reply: string;
    patch?: BoardPatch;
};

const SYSTEM_PROMPT = `
You are an "AI Board Assistant" for a collaborative math & diagram whiteboard.

You receive:
- a LIGHTWEIGHT JSON boardContext (objects with id, type, x, y, width, height, text/latex),
- optional viewport info,
- a user request.

GENERAL RULES:
1. IDs and Coordinates
   - Treat "id" as STABLE identifiers. Reuse them when updating or deleting objects.
   - Use (x, y, width, height) for precise placement.
   - Prefer relative and structured layouts (aligned, neat).
   - Trust the provided JSON snapshot. If an ID is not in the snapshot, it does not exist.

2. Tool Usage
   - Prefer HIGH-LEVEL tools over "draw_board_patch" when possible:
     * "connect_objects" -> for arrows/vectors between shapes.
     * "label_object" -> to attach text/LaTeX to shapes.
     * "set_style" -> to change visual properties (color, stroke, line style).
     * "delete_objects" -> to remove items.
   - Use "draw_board_patch" for creating main shapes (rectangles, circles, lines) or complex batch edits.
   - Use "strokeMode": "handdrawn" for sketches/informal drawings, and "clean" for formal diagrams/graphs.
   - Limit creation to max ~40 objects per turn to avoid performance issues.
   - Do NOT use "generate_diagram_from_prompt". Use primitive tools to build diagrams.

3. Math & LaTeX
   - Use "label_object" with mode="latex" for labels attached to objects.
   - Use "insert_latex_box" for standalone equations.
   - Keep LaTeX readable and standard.

4. Style of responses
   - Perform the action using tools, then reply with a short (1-3 sentences) explanation.
   - Do not describe every single coordinate you changed.
`;

export async function runBoardAgent(params: {
    doc: BoardDoc;
    snapshot: BoardSnapshot;
    userMessage: string;
    viewport?: { x: number; y: number; width: number; height: number };
    image?: string;
}): Promise<AgentResult> {
    if (!llmClient) {
        return { reply: 'Board assistant is not configured on the server.' };
    }

    const { doc, snapshot, userMessage, viewport, image } = params;

    // 🔥 LEKKI kontekst zamiast pełnego snapshotu
    const agentContext = buildAgentBoardContext(snapshot, viewport, 64);

    let userContent: any = JSON.stringify({
        boardContext: agentContext,
        request: userMessage,
    });

    if (image) {
        userContent = [
            {
                type: 'text',
                text: JSON.stringify({
                    boardContext: agentContext,
                    request: userMessage,
                    note: 'The image shows the visual board. Use it mainly to read handwriting or check spatial relationships that are not obvious from the JSON context.',
                }),
            },
            {
                type: 'image_url',
                image_url: { url: image },
            },
        ];
    }

    // RAG: Retrieve relevant docs
    const docs = retrieveBoardDocs(userMessage);

    const baseMessages: ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...(docs.length
            ? [
                {
                    role: 'system',
                    content:
                        'Board JSON schema and tools (documentation):\n\n' + docs.join('\n\n'),
                } as ChatCompletionMessageParam,
            ]
            : []),
        {
            role: 'user',
            content: userContent,
        },
    ];

    // 1) First call - model decides on tool_calls
    let first;
    try {
        first = await llmClient.chat.completions.create({
            model: BOARD_AI_MODEL,
            temperature: 0.1,
            messages: baseMessages,
            tools: boardToolsSchema as ChatCompletionTool[],
            tool_choice: 'auto',
        });
    } catch (error) {
        console.error('[AI] Error calling AI model:', error);
        return {
            reply: `Failed to connect to AI service. ${error instanceof Error ? error.message : 'Unknown error'}`
        };
    }

    if (!first.choices || first.choices.length === 0) {
        console.error('[AI] No choices in response:', JSON.stringify(first, null, 2));
        return { reply: 'No response from AI model. Please try again.' };
    }

    const firstMsg = first.choices[0]!.message;

    if (!firstMsg) {
        console.error('[AI] No message in first choice:', JSON.stringify(first.choices[0], null, 2));
        return { reply: 'AI model returned an invalid response. Please try again.' };
    }

    // If no tool_calls - just return text
    if (!firstMsg.tool_calls || firstMsg.tool_calls.length === 0) {
        return { reply: firstMsg.content ?? '' };
    }

    const toolMessages: ChatCompletionMessageParam[] = [];
    let lastPatch: BoardPatch | undefined;

    // 2) Execute tools on server side
    for (const toolCall of firstMsg.tool_calls!) {
        if (!('function' in toolCall) || !toolCall.function) {
            console.warn('[AI] Skipping tool call without function property:', toolCall);
            continue;
        }

        const { name, arguments: rawArgs } = toolCall.function;
        let args;
        try {
            args = JSON.parse(rawArgs || '{}');
        } catch (e) {
            console.error('[AI] Failed to parse tool arguments:', e);
            toolMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ status: 'error', message: 'Invalid JSON arguments' }),
            });
            continue;
        }

        switch (name) {
            case 'align_selection_to_grid': {
                const patch = toolAlignSelectionToGrid(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'connect_objects': {
                const patch = toolConnectObjects(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'label_object': {
                const patch = toolLabelObject(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'set_style': {
                const patch = toolSetStyle(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'delete_objects': {
                const patch = toolDeleteObjects(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'simplify_equation_block': {
                const equation = snapshot.objects.find(o => o.id === args.objectId);
                const original = equation?.text ?? '';
                let latex = original;

                try {
                    const simp = await llmClient.chat.completions.create({
                        model: BOARD_AI_MODEL,
                        temperature: 0.0,
                        messages: [
                            {
                                role: 'system',
                                content:
                                    'You simplify math expressions and output LaTeX only, without commentary.',
                            },
                            {
                                role: 'user',
                                content: original,
                            },
                        ],
                    });
                    latex = simp.choices[0]?.message.content ?? original;
                } catch (e) {
                    console.error('[AI] Error simplifying equation:', e);
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({ status: 'error', message: 'Failed to simplify equation' }),
                    });
                    break;
                }
                const patch = toolSimplifyEquationBlock(doc, snapshot, args, latex);
                lastPatch = patch;

                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'draw_board_patch': {
                const patch = toolDrawBoardPatch(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'insert_latex_box': {
                const patch = toolInsertLatexBox(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'text_block_to_latex': {
                const block = snapshot.objects.find(o => o.id === args.objectId);
                const original = block?.text ?? '';
                let latex = original;

                try {
                    const simp = await llmClient.chat.completions.create({
                        model: BOARD_AI_MODEL,
                        temperature: 0.0,
                        messages: [
                            {
                                role: 'system',
                                content:
                                    'Convert the following math text to pure LaTeX (inline or display). Output ONLY LaTeX, no commentary.',
                            },
                            { role: 'user', content: original },
                        ],
                    });
                    latex = simp.choices[0]?.message.content ?? original;
                } catch (e) {
                    console.error('[AI] Error converting text to latex:', e);
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({ status: 'error', message: 'Failed to convert text to latex' }),
                    });
                    break;
                }

                const patch = toolTextBlockToLatexUpdate(doc, snapshot, args, latex);
                lastPatch = patch;

                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            case 'plot_function': {
                const patch = toolPlotFunction(doc, snapshot, args);
                lastPatch = patch;
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'ok', patch }),
                });
                break;
            }

            // Legacy support or deprecated
            case 'generate_diagram_from_prompt':
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'error', message: 'Tool deprecated. Use draw_board_patch or connect_objects instead.' }),
                });
                break;

            default:
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({ status: 'error', message: 'Unknown tool' }),
                });
        }
    }

    // 3) Second call - model sees tool results and returns text for user
    let second;
    try {
        second = await llmClient.chat.completions.create({
            model: BOARD_AI_MODEL,
            temperature: 0.2,
            messages: [
                ...baseMessages,
                firstMsg,
                ...toolMessages,
            ],
        });
    } catch (error) {
        console.error('[AI] Error in second AI model call:', error);
        return { reply: 'Failed to generate final response from AI service.', ...(lastPatch && { patch: lastPatch }) };
    }

    if (!second.choices || second.choices.length === 0) {
        return { reply: 'AI model returned no final response.', ...(lastPatch && { patch: lastPatch }) };
    }

    const reply = second.choices[0]?.message?.content ?? '';
    return { reply, ...(lastPatch && { patch: lastPatch }) };
}
