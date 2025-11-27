import type { ChatCompletionTool } from 'openai/resources/chat/completions';

export const boardToolsSchema: ChatCompletionTool[] = [
    {
        type: 'function',
        function: {
            name: 'align_selection_to_grid',
            description:
                'Align selected board objects to the nearest grid lines. Works for shapes and handwriting paths.',
            parameters: {
                type: 'object',
                properties: {
                    gridSize: {
                        type: 'number',
                        description: 'Grid spacing in pixels, e.g. 16.',
                    },
                    selectionIds: {
                        type: 'array',
                        items: { type: 'string' },
                        description:
                            'Optional: IDs of objects to align. If omitted, use objects marked as selected=true.',
                    },
                },
                required: ['gridSize'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'connect_objects',
            description:
                'Draw an arrow (vector) from one existing object to another using their bounding-box centers.',
            parameters: {
                type: 'object',
                properties: {
                    fromId: { type: 'string', description: 'Source object id' },
                    toId: { type: 'string', description: 'Target object id' },
                    style: {
                        type: 'object',
                        description: 'Optional style overrides',
                        properties: {
                            lineWidth: { type: 'number', description: 'Stroke width in px (1–8)' },
                            lineStyle: {
                                type: 'string',
                                enum: ['solid', 'dashed', 'dotted'],
                            },
                            arrowHead: {
                                type: 'string',
                                enum: ['end', 'both'],
                                description: 'Arrowhead direction (default "end")',
                            },
                            color: {
                                type: 'string',
                                description: 'Stroke color hex, e.g. "#000000"',
                            },
                            strokeMode: {
                                type: 'string',
                                enum: ['clean', 'handdrawn'],
                                description: 'Line drawing style: "clean" for diagrams, "handdrawn" for sketches.',
                            },
                        },
                    },
                },
                required: ['fromId', 'toId'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'label_object',
            description:
                'Create a short label (plain text or LaTeX) attached to an existing object (top/bottom/left/right/center).',
            parameters: {
                type: 'object',
                properties: {
                    objectId: { type: 'string' },
                    text: {
                        type: 'string',
                        description: 'Label content. For LaTeX do NOT add $ or \\( \\).',
                    },
                    mode: {
                        type: 'string',
                        enum: ['plain', 'latex'],
                        description: 'Render as normal text or LaTeX block.',
                        default: 'plain',
                    },
                    position: {
                        type: 'string',
                        enum: ['top', 'bottom', 'left', 'right', 'center'],
                        default: 'top',
                    },
                },
                required: ['objectId', 'text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'set_style',
            description:
                'Update visual style of one or more objects: stroke width, dash, color, arrowStyle, strokeMode etc.',
            parameters: {
                type: 'object',
                properties: {
                    ids: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'Object ids to update.',
                    },
                    props: {
                        type: 'object',
                        description: 'Style props to apply to all given ids.',
                        properties: {
                            lineWidth: { type: 'number' },
                            lineStyle: {
                                type: 'string',
                                enum: ['solid', 'dashed', 'dotted'],
                            },
                            arrowStyle: {
                                type: 'string',
                                enum: ['none', 'start', 'end', 'both'],
                            },
                            strokeColor: { type: 'string' },
                            fillColor: { type: 'string' },
                            strokeMode: {
                                type: 'string',
                                enum: ['clean', 'handdrawn'],
                            },
                        },
                        additionalProperties: false,
                    },
                },
                required: ['ids', 'props'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'delete_objects',
            description: 'Delete one or more objects from the board by their ids.',
            parameters: {
                type: 'object',
                properties: {
                    ids: {
                        type: 'array',
                        items: { type: 'string' },
                    },
                },
                required: ['ids'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'simplify_equation_block',
            description: 'Take a raw text block (e.g. handwriting OCR) and replace it with a simplified LaTeX version.',
            parameters: {
                type: 'object',
                properties: {
                    objectId: {
                        type: 'string',
                        description: 'The ID of the object containing the raw equation text.',
                    },
                },
                required: ['objectId'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'draw_board_patch',
            description:
                'Create, update or delete board objects directly. Use for low-level drawing when higher-level tools like connect_objects or label_object are not sufficient.',
            parameters: {
                type: 'object',
                properties: {
                    creates: {
                        type: 'array',
                        items: {
                            type: 'object',
                            description: 'A board object to create.',
                            properties: {
                                id: {
                                    type: 'string',
                                    description:
                                        'Stable unique ID, e.g. "ai-note-1". Reuse it later to edit the same object.',
                                },
                                type: {
                                    type: 'string',
                                    enum: [
                                        'rectangle',
                                        'circle',
                                        'line',
                                        'text',
                                        'latex',
                                        'functionPlot',
                                        'path',
                                        'image',
                                        'triangle',
                                        'diamond',
                                        'coordinateSystem2D',
                                        'mathFunctionPlot',
                                        'physicsDataPlot',
                                        'coordinateSystem3D',
                                        'cube',
                                        'cuboid',
                                        'sphere',
                                        'cylinder',
                                        'cone',
                                        'pyramid',
                                        'tetrahedron',
                                    ],
                                },
                                x: { type: 'number' },
                                y: { type: 'number' },
                                width: { type: 'number', description: 'Required for shapes. Optional for path.' },
                                height: { type: 'number', description: 'Required for shapes. Optional for path.' },
                                text: { type: 'string' },
                                latex: { type: 'string' },
                                color: {
                                    type: 'string',
                                    description: 'Hex color code (e.g. "#ff0000").',
                                },
                                rotation: {
                                    type: 'number',
                                    description: 'Rotation in degrees.',
                                },
                                lineWidth: { type: 'number', description: 'Stroke width in px' },
                                lineStyle: {
                                    type: 'string',
                                    enum: ['solid', 'dashed', 'dotted'],
                                },
                                arrowStyle: {
                                    type: 'string',
                                    enum: ['none', 'start', 'end', 'both'],
                                },
                                strokeMode: {
                                    type: 'string',
                                    enum: ['clean', 'handdrawn'],
                                },
                                fillColor: { type: 'string' },
                                strokeColor: { type: 'string' },
                                points: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            x: { type: 'number' },
                                            y: { type: 'number' },
                                        },
                                    },
                                },
                            },
                            required: ['id', 'type', 'x', 'y'],
                        },
                    },
                    updates: {
                        type: 'array',
                        items: {
                            type: 'object',
                            properties: {
                                id: { type: 'string' },
                                props: {
                                    type: 'object',
                                    description:
                                        'Properties to update (x, y, width, height, text, latex, color, style etc.)',
                                },
                            },
                            required: ['id', 'props'],
                        },
                    },
                    deletes: {
                        type: 'array',
                        items: { type: 'string' },
                        description: 'IDs of objects to delete from the board.',
                    },
                },
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'insert_latex_box',
            description: 'Insert a new LaTeX equation block at a specific position.',
            parameters: {
                type: 'object',
                properties: {
                    latex: { type: 'string', description: 'The LaTeX code to render. Do NOT include delimiters like $ or \\(.' },
                    x: { type: 'number' },
                    y: { type: 'number' },
                    width: { type: 'number' },
                    height: { type: 'number' },
                },
                required: ['latex'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'text_block_to_latex',
            description: 'Convert an existing text object into a rendered LaTeX block.',
            parameters: {
                type: 'object',
                properties: {
                    objectId: { type: 'string', description: 'ID of the text object to convert.' },
                },
                required: ['objectId'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'plot_function',
            description: 'Create a function plot (graph) on the board.',
            parameters: {
                type: 'object',
                properties: {
                    expression: { type: 'string', description: 'Math expression of x, e.g. "sin(x)" or "x^2".' },
                    xMin: { type: 'number', description: 'Domain start (default -10).' },
                    xMax: { type: 'number', description: 'Domain end (default 10).' },
                    x: { type: 'number', description: 'Position X.' },
                    y: { type: 'number', description: 'Position Y.' },
                },
                required: ['expression'],
            },
        },
    },
];
