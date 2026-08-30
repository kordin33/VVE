import { reactive, readonly } from 'vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

// Singleton state with enhanced status tracking
const state = reactive({
    isRunning: false,
    lastReply: null,
    error: null,
    // New: Real-time progress tracking
    currentStatus: '', // e.g., 'Calling model...', 'Executing draw_board_patch...'
    toolsUsed: [],     // Array of tool names used in the last request
    startTime: null,   // For elapsed time tracking
    elapsedMs: 0,
});

let statusInterval = null;

export function useAiStore() {
    const updateElapsed = () => {
        if (state.startTime) {
            state.elapsedMs = Date.now() - state.startTime;
        }
    };

    const runBoardAssistant = async (boardId, message, viewport, screenshotDataUrl, model, wsToken) => {
        if (state.isRunning) return;
        state.isRunning = true;
        state.error = null;
        state.currentStatus = 'Wysyłanie zapytania...';
        state.toolsUsed = [];
        state.startTime = Date.now();
        state.elapsedMs = 0;

        // Update elapsed time every 100ms
        statusInterval = setInterval(updateElapsed, 100);

        try {
            const baseUrl = resolveBackendBaseUrl();
            state.currentStatus = `Łączenie z ${model?.split('/')[1] || 'AI'}...`;

            const headers = { 'Content-Type': 'application/json' };
            if (wsToken) headers['X-Board-Token'] = wsToken;

            const res = await fetch(`${baseUrl}/api/ai/board-assistant`, {
                method: 'POST',
                headers,
                body: JSON.stringify({ boardId, message, viewport, image: screenshotDataUrl, model }),
            });

            state.currentStatus = 'Przetwarzanie odpowiedzi...';

            if (!res.ok) {
                const errorText = await res.text();
                throw new Error(`Server error ${res.status}: ${errorText}`);
            }

            const data = await res.json();
            state.lastReply = data.reply;

            // Extract tools used from the response if available
            if (data.toolsUsed && Array.isArray(data.toolsUsed)) {
                state.toolsUsed = data.toolsUsed;
            } else if (data.patch) {
                // Infer from patch
                const tools = [];
                if (data.patch.creates?.length) tools.push(`draw_board_patch (${data.patch.creates.length} creates)`);
                if (data.patch.updates?.length) tools.push(`draw_board_patch (${data.patch.updates.length} updates)`);
                if (data.patch.deletes?.length) tools.push(`delete_objects (${data.patch.deletes.length})`);
                state.toolsUsed = tools;
            }

            state.currentStatus = 'Gotowe!';

        } catch (err) {
            console.error('Board Assistant Error:', err);
            state.error = err.message;
            state.currentStatus = 'Błąd!';

            // Check for empty response which indicates model didn't return anything
            if (err.message?.includes('empty') || !state.lastReply) {
                state.lastReply = 'AI model returned an empty response. This may be a temporary issue with the AI service. Please try again.';
            }
        } finally {
            clearInterval(statusInterval);
            state.isRunning = false;
            updateElapsed();
        }
    };

    return {
        state: readonly(state),
        runBoardAssistant
    };
}
