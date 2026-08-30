import type {
    ChatCompletionMessageParam,
    ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { llmClient, BOARD_AI_MODEL } from '../provider/llmClient';
import { BoardDoc } from '../../yjs/boardDoc';
import { BoardSnapshot, BoardPatch } from '../../models/boardSnapshot';
import { boardToolsSchema } from './boardToolsSchema';
import {
    toolAlignSelectionToGrid,
    toolSimplifyEquationBlock,
    toolDrawBoardPatch,
    toolInsertLatexBox,
    toolTextBlockToLatexUpdate,
    toolPlotFunction,
    toolConnectObjects,
    toolLabelObject,
    toolSetStyle,
    toolDeleteObjects,
    toolDrawHandstroke,
    toolDistributeHorizontally,
    toolDistributeVertically,
    toolCloneObject,
    toolMoveObject,
    toolSolveEquation,
} from '../tools/boardTools';
import { retrieveBoardDocs } from '../docs/boardCapabilities';
import { buildAgentBoardContext } from './boardAgentContext';
import { extractTextFromImage, extractEquationsFromText } from '../ocr/ocrService';
import { logger } from '../../logger';

if (!llmClient) {
    logger.warn('[AI] Board Assistant disabled – no LLM client configured');
}

type AgentResult = {
    reply: string;
    patch?: BoardPatch;
};

const SYSTEM_PROMPT = `
You are an AI Board Assistant for a collaborative math & diagram whiteboard.
Your task is to accurately draw shapes, diagrams, and mathematical figures.

═══════════════════════════════════════════════════════════════════
COORDINATE SYSTEM
═══════════════════════════════════════════════════════════════════
- Origin (0,0): TOP-LEFT corner of canvas
- X-axis: increases → RIGHT (0 to ~800)
- Y-axis: increases ↓ DOWN (0 to ~600)
- Grid: 8px (coordinates snap to multiples of 8)

KEY CONCEPT: Lower Y value = higher on screen.
If you want object B below object A: B.y > A.y

═══════════════════════════════════════════════════════════════════
SHAPE PROPERTIES (for draw_board_patch)
═══════════════════════════════════════════════════════════════════
Required for EVERY shape:
- type: "circle" | "rectangle" | "square" | "triangle" | "diamond" | "line" | "text" | "latex"
- x: left edge X coordinate (number)
- y: top edge Y coordinate (number)
- width: horizontal size in pixels (number, min 8)
- height: vertical size in pixels (number, min 8)
- color: stroke color as hex string (e.g., "#000000")

Optional:
- fillColor: fill color as hex (e.g., "#FFFFFF" for white)
- lineWidth: stroke thickness 1-8 (default 2)
- arrowStyle: "none" | "end" | "start" | "both" (for type="line")
- rotation: angle in degrees

═══════════════════════════════════════════════════════════════════
GEOMETRIC COMPUTATION FORMULAS (use these for precise positioning)
═══════════════════════════════════════════════════════════════════

BOUNDING BOX EDGES:
- left   = x
- right  = x + width
- top    = y
- bottom = y + height

CENTER POINT:
- centerX = x + width/2
- centerY = y + height/2

OBJECTS TOUCHING (no gap):
- Vertical: objectB.y = objectA.y + objectA.height
- Horizontal: objectB.x = objectA.x + objectA.width

OBJECT B INSIDE OBJECT A (containment):
- B.x >= A.x AND B.x + B.width <= A.x + A.width
- B.y >= A.y AND B.y + B.height <= A.y + A.height

CENTER ALIGNMENT (same horizontal center):
- B.x = A.x + (A.width - B.width) / 2

RELATIVE POSITIONING:
- To place B at left edge of A: B.x = A.x - B.width
- To place B at right edge of A: B.x = A.x + A.width
- To place B at vertical center of A: B.y = A.y + (A.height - B.height) / 2

LINE FROM POINT (startX, startY) TO (endX, endY):
- x = startX
- y = startY
- width = endX - startX (can be negative)
- height = endY - startY (can be negative)

═══════════════════════════════════════════════════════════════════
AVAILABLE TOOLS
═══════════════════════════════════════════════════════════════════
1. draw_board_patch
   - Creates new shapes with "creates" array
   - Updates existing shapes with "updates" array  
   - Deletes shapes with "deletes" array
   - PRIMARY tool for drawing anything new

2. connect_objects
   - Draws arrow/line between two existing objects by ID
   - Use for connecting diagram elements

3. label_object
   - Adds text label to existing object
   - Automatically positions relative to object

4. set_style
   - Changes color, lineWidth, fillColor of existing objects

5. move_object
   - Repositions existing object to new coordinates

6. solve_equation
   - Solves mathematical equations SYMBOLICALLY (using Python/SymPy)
   - Returns EXACT results: sqrt(2), not 1.414...
   - Use for: quadratic equations, systems of equations, complex algebra
   - Automatically inserts result as LaTeX on the board
   - PREFER this over manual solving for complex equations


═══════════════════════════════════════════════════════════════════
SPATIAL REASONING PRINCIPLES
═══════════════════════════════════════════════════════════════════
When drawing multi-part figures:
1. Plan the overall layout first (what goes where)
2. Calculate parent/container positions first
3. Calculate child/detail positions RELATIVE to parents
4. Use the formulas above for precise placement
5. Verify: children should be within parent bounds

Common patterns:
- Stacked objects: each subsequent y = previous y + previous height
- Centered children: child.x = parent.x + (parent.width - child.width)/2
- Side-by-side: second.x = first.x + first.width + gap

═══════════════════════════════════════════════════════════════════
EXECUTION RULES
═══════════════════════════════════════════════════════════════════
- You MUST call a tool to make changes. Text without tool calls = nothing happens.
- ALWAYS include "color" - shapes without color are invisible.
- Width and height must be > 0.
- For complex drawings, create ALL objects in a single draw_board_patch call.
- Double-check your coordinate calculations before calling the tool.

You have access to boardContext.objects with existing shapes.
Each has: id, type, x, y, width, height, left, right, top, bottom, centerX, centerY.
`;

export async function runBoardAgent(params: {
    doc: BoardDoc;
    snapshot: BoardSnapshot;
    userMessage: string;
    viewport?: { x: number; y: number; width: number; height: number };
    image?: string;
    model?: string;
}): Promise<AgentResult> {
    logger.info('[AI Agent] Request received', { userMessage: params.userMessage, model: params.model });
    if (!llmClient) {
        return { reply: 'Board assistant is not configured on the server.' };
    }

    const { doc, snapshot, userMessage, viewport, image, model } = params;
    const effectiveModel = model || BOARD_AI_MODEL;
    logger.info('[AI Agent] Using model', { model: effectiveModel });

    // Lekki kontekst zamiast pełnego snapshotu
    const agentContext = buildAgentBoardContext(snapshot, viewport, 64);

    let userContent: any = JSON.stringify({
        boardContext: agentContext,
        request: userMessage,
    });

    // Modele, które traktujemy jako tekstowe (bez obrazów)
    const textOnlyModels = [
        'kwaipilot/kat-coder-pro:free',
        'openai/gpt-oss-120b:exacto',
        'deepseek/deepseek-v3.2',
    ];

    const isTextOnlyModel = textOnlyModels.includes(effectiveModel);
    const shouldSendImage = image && !isTextOnlyModel;

    // For text-only models with handwriting: use OCR to extract text from image
    let ocrText = '';
    let ocrEquations: string[] = [];

    if (isTextOnlyModel && image) {
        logger.info('[AI Agent] Running OCR for text-only model', { model: effectiveModel });
        try {
            ocrText = await extractTextFromImage(image);
            ocrEquations = extractEquationsFromText(ocrText);
            logger.info('[AI Agent] OCR extraction complete', { equationCount: ocrEquations.length });
        } catch (err) {
            logger.warn('[AI Agent] OCR failed', { error: err });
        }
    }

    if (shouldSendImage) {
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
    } else if (image && isTextOnlyModel) {
        // Text-only model with OCR results
        logger.info('[AI Agent] Using OCR text instead of image', { model: effectiveModel });
        userContent = JSON.stringify({
            boardContext: agentContext,
            request: userMessage,
            ocrExtractedText: ocrText || '(OCR could not extract text)',
            ocrPotentialEquations: ocrEquations,
            note: 'The ocrExtractedText contains handwritten content from the board (extracted via OCR). Use this to understand what was written by hand.',
        });
    } else if (image) {
        logger.debug('[AI Agent] Skipping image for text-only model', { model: effectiveModel });
    }

    // RAG: dokumentacja narzędzi / schematu
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

    // 1) Pierwsze wywołanie – model decyduje jakie tools wywołać
    let first;
    try {
        first = await llmClient.chat.completions.create({
            model: effectiveModel,
            temperature: 0,  // Maximum determinism for consistent drawings
            messages: baseMessages,
            tools: boardToolsSchema as ChatCompletionTool[],
            tool_choice: 'auto',
        });
    } catch (error) {
        logger.error('[AI] Error calling AI model', { error });
        return {
            reply: `Failed to connect to AI service. ${error instanceof Error ? error.message : 'Unknown error'
                }`,
        };
    }

    if (!first.choices || first.choices.length === 0) {
        logger.error('[AI] No choices in response', { model: effectiveModel });
        return { reply: 'No response from AI model. Please try again.' };
    }

    const firstMsg = first.choices[0]!.message;

    if (!firstMsg) {
        logger.error('[AI] No message in first choice', { finishReason: first.choices[0]?.finish_reason });
        return { reply: 'AI model returned an invalid response. Please try again.' };
    }

    // --- DSML Parsing Fix for DeepSeek V3 ---
    // DeepSeek sometimes returns raw DSML tags instead of native tool_calls
    if (firstMsg.content && firstMsg.content.includes('<｜DSML｜function_calls>')) {
        logger.info('[AI Agent] Detected DSML format, attempting repair');
        try {
            const content = firstMsg.content;
            const toolCalls: any[] = [];

            // Regex to match invokes: <｜DSML｜invoke name="toolName"> ...params... </｜DSML｜invoke>
            const invokeRegex = /<｜DSML｜invoke name="([^"]+)">([\s\S]*?)<\/｜DSML｜invoke>/g;
            let match;

            while ((match = invokeRegex.exec(content)) !== null) {
                const toolName = match[1]!;
                const innerContent = match[2]!;
                const args: Record<string, any> = {};

                // Parse parameters: <｜DSML｜parameter name="paramName" string="false">value</｜DSML｜parameter>
                // string="true" might mean value is a string literal? Usually JSON inside.
                const paramRegex = /<｜DSML｜parameter name="([^"]+)"(?:\s+string="([^"]+)")?>([\s\S]*?)<\/｜DSML｜parameter>/g;
                let paramMatch;

                while ((paramMatch = paramRegex.exec(innerContent)) !== null) {
                    const pName = paramMatch[1]!;
                    const pValueRaw = paramMatch[3]!;
                    try {
                        // Try to parse as JSON first
                        args[pName] = JSON.parse(pValueRaw);
                    } catch {
                        // Fallback to raw string
                        args[pName] = pValueRaw;
                    }
                }

                toolCalls.push({
                    id: `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
                    type: 'function',
                    function: {
                        name: toolName,
                        arguments: JSON.stringify(args)
                    }
                });
            }

            if (toolCalls.length > 0) {
                logger.info('[AI Agent] Repaired DSML tool calls', { count: toolCalls.length });
                firstMsg.tool_calls = toolCalls;
                // Clear content to avoid treating it as text response
                firstMsg.content = null;
            }
        } catch (e) {
            logger.error('[AI Agent] DSML parsing failed', { error: e });
        }
    }
    // ----------------------------------------

    const hasContent = typeof firstMsg.content === 'string' && firstMsg.content.trim().length > 0;
    const hasToolCalls = !!firstMsg.tool_calls && firstMsg.tool_calls.length > 0;

    if (!hasContent && !hasToolCalls) {
        logger.error('[AI] Empty response from model', {
            model: BOARD_AI_MODEL,
            finishReason: first.choices[0]?.finish_reason,
        });
        return {
            reply:
                'AI model returned an empty response. This may be a temporary issue with the AI service. Please try again.',
        };
    }

    // Jeśli model nie wywołuje żadnych narzędzi – zwracamy tylko tekst
    if (!hasToolCalls) {
        // Check if user was asking to draw something
        const drawingKeywords = ['narysuj', 'rysuj', 'draw', 'dodaj', 'utwórz', 'stwórz', 'create', 'bałwan', 'snowman', 'circle', 'koło'];
        const wasDrawingRequest = drawingKeywords.some(kw =>
            userMessage.toLowerCase().includes(kw)
        );

        if (wasDrawingRequest) {
            logger.warn('[AI] Model returned text but user requested drawing, no tool called', { model: effectiveModel });
            return {
                reply: `${firstMsg.content ?? ''}\n\n⚠️ _Model nie wywołał żadnego narzędzia rysowania. Spróbuj użyć innego modelu lub sformułuj prośbę inaczej._`
            };
        }
        return { reply: firstMsg.content ?? '' };
    }

    const toolMessages: ChatCompletionMessageParam[] = [];
    let lastPatch: BoardPatch | undefined;

    // Bardzo ważne: używamy "żywego" snapshotu, aktualizowanego po każdym patchu
    let workingSnapshot: BoardSnapshot = snapshot;

    // 2) Wykonanie tooli po stronie serwera
    for (const toolCall of firstMsg.tool_calls!) {
        if (!('function' in toolCall) || !toolCall.function) {
            logger.warn('[AI] Skipping tool call without function property', { toolCallId: toolCall.id });
            continue;
        }

        const { name, arguments: rawArgs } = toolCall.function;
        let args: any;
        try {
            args = JSON.parse(rawArgs || '{}');
            logger.info('[AI Agent] Tool call', { tool: name, argsPreview: JSON.stringify(args).substring(0, 200) });
        } catch (e) {
            logger.error('[AI] Failed to parse tool arguments', { tool: name, error: e });
            toolMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                    status: 'error',
                    message: 'Invalid JSON arguments',
                }),
            });
            continue;
        }

        const respondOk = (patch: BoardPatch) => {
            lastPatch = patch;
            // po każdej modyfikacji odświeżamy snapshot, żeby kolejne tool calls widziały aktualny stan
            workingSnapshot = params.doc.getSnapshot();
            toolMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify({ status: 'ok', patch }),
            });
        };

        switch (name) {
            case 'align_selection_to_grid': {
                const patch = toolAlignSelectionToGrid(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'simplify_equation_block': {
                const equation = workingSnapshot.objects.find(o => o.id === args.objectId);
                const original = equation?.text ?? '';
                let latex = original;

                try {
                    const simp = await llmClient.chat.completions.create({
                        model: effectiveModel,
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
                    logger.error('[AI] Error simplifying equation', { error: e });
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            status: 'error',
                            message: 'Failed to simplify equation',
                        }),
                    });
                    break;
                }

                const patch = toolSimplifyEquationBlock(doc, workingSnapshot, args, latex);
                respondOk(patch);
                break;
            }

            case 'draw_board_patch': {
                const patch = toolDrawBoardPatch(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'insert_latex_box': {
                const patch = toolInsertLatexBox(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'text_block_to_latex': {
                const block = workingSnapshot.objects.find(o => o.id === args.objectId);
                const original = block?.text ?? '';
                let latex = original;

                try {
                    const simp = await llmClient.chat.completions.create({
                        model: effectiveModel,
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
                    logger.error('[AI] Error converting text to latex', { error: e });
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            status: 'error',
                            message: 'Failed to convert text to latex',
                        }),
                    });
                    break;
                }

                const patch = toolTextBlockToLatexUpdate(doc, workingSnapshot, args, latex);
                respondOk(patch);
                break;
            }

            case 'plot_function': {
                const patch = toolPlotFunction(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'connect_objects': {
                const patch = toolConnectObjects(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'label_object': {
                const patch = toolLabelObject(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'set_style': {
                const patch = toolSetStyle(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'delete_objects': {
                const patch = toolDeleteObjects(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'draw_handstroke': {
                const patch = toolDrawHandstroke(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'distribute_horizontally': {
                const patch = toolDistributeHorizontally(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'distribute_vertically': {
                const patch = toolDistributeVertically(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'clone_object': {
                const patch = toolCloneObject(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'move_object': {
                const patch = toolMoveObject(doc, workingSnapshot, args);
                respondOk(patch);
                break;
            }

            case 'solve_equation': {
                try {
                    const { patch, result } = await toolSolveEquation(doc, workingSnapshot, args);
                    lastPatch = patch;
                    workingSnapshot = params.doc.getSnapshot();
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            status: result.success ? 'ok' : 'error',
                            ...result,
                        }),
                    });
                } catch (err: any) {
                    toolMessages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        content: JSON.stringify({
                            status: 'error',
                            message: err.message || 'Failed to solve equation',
                        }),
                    });
                }
                break;
            }

            default:
                toolMessages.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: JSON.stringify({
                        status: 'error',
                        message: `Unknown tool: ${name}`,
                    }),
                });
        }
    }

    // 3) Drugie wywołanie – model widzi wyniki tooli i generuje odpowiedź tekstową
    let second;
    try {
        second = await llmClient.chat.completions.create({
            model: effectiveModel,
            temperature: 0.2,
            messages: [...baseMessages, firstMsg, ...toolMessages],
        });
    } catch (error) {
        logger.error('[AI] Error in second AI model call', { error });
        return {
            reply: 'Failed to generate final response from AI service.',
            ...(lastPatch && { patch: lastPatch }),
        };
    }

    if (!second.choices || second.choices.length === 0) {
        return {
            reply: 'AI model returned no final response.',
            ...(lastPatch && { patch: lastPatch }),
        };
    }

    const reply = second.choices[0]?.message?.content ?? '';
    return { reply, ...(lastPatch && { patch: lastPatch }) };
}
