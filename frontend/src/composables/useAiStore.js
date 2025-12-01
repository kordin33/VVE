import { reactive, readonly } from 'vue';
import { resolveBackendBaseUrl } from '../services/backendUrl';

// Singleton state
const state = reactive({
    isRunning: false,
    lastReply: null,
    error: null,
    pulsingObjects: new Set()
});

export function useAiStore() {
    const runBoardAssistant = async (boardId, message, viewport, screenshotDataUrl, model) => {
        if (state.isRunning) return;
        state.isRunning = true;
        state.error = null;

        try {
            const baseUrl = resolveBackendBaseUrl();
            const res = await fetch(`${baseUrl}/api/ai/board-assistant`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ boardId, message, viewport, image: screenshotDataUrl, model }),
            });

            if (!res.ok) {
                throw new Error(`Server error: ${res.status}`);
            }

            const data = await res.json();
            state.lastReply = data.reply;

            // Patch is applied by server via Yjs, so we don't need to apply it manually here.
            // However, we can use the patch info to trigger visual effects.
            if (data.patch && (data.patch.creates || data.patch.updates)) {
                const ids = [];
                if (data.patch.creates) {
                    data.patch.creates.forEach(obj => ids.push(obj.id));
                }
                if (data.patch.updates) {
                    data.patch.updates.forEach(obj => ids.push(obj.id));
                }

                // Add to pulsing set
                ids.forEach(id => state.pulsingObjects.add(id));

                // Remove after 2 seconds
                setTimeout(() => {
                    ids.forEach(id => state.pulsingObjects.delete(id));
                }, 2000);
            }

        } catch (err) {
            console.error('Board Assistant Error:', err);
            state.error = err.message;
        } finally {
            state.isRunning = false;
        }
    };

    return {
        state: readonly(state),
        runBoardAssistant
    };
}
