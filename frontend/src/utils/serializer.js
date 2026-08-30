/**
 * Serializer module - converts whiteboard state to/from JSON and compressed formats
 * 
 * This will be important for Discord integration as we want to make the 
 * serialized state as compact as possible to fit in Discord messages.
 */

// Basic JSON serialization/deserialization
export const serialize = (state) => {
  try {
    return JSON.stringify(state);
  } catch (e) {
    console.error('Failed to serialize state:', e);
    return null;
  }
};

export const deserialize = (text) => {
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('Failed to deserialize state:', e);
    return null;
  }
};

/**
 * Advanced serialization for more compact representation
 * 
 * For a production app, we would implement data compression here
 * to reduce the size of the state for storage in Discord.
 * 
 * Strategies could include:
 * 1. Using abbreviated property names
 * 2. Using relative coordinates for points
 * 3. Using delta encoding for sequential points (only storing differences)
 * 4. Actual compression algorithms
 */
export const compactSerialize = (state) => {
  // Create a more compact representation
  const compactState = {
    v: 1, // version number for future compatibility
    w: state.canvasWidth,
    h: state.canvasHeight,
    // 7.5: Include all relevant element fields in compact format
    e: state.elements.map(element => {
      const compact = {
        t: element.type.charAt(0), // p for pen, e for eraser, etc.
        c: element.color,
        w: element.lineWidth,
        p: compressPoints(element.points)
      };
      // Optional fields — only include if defined
      if (element.fillColor) compact.fc = element.fillColor;
      if (element.strokeColor) compact.sc = element.strokeColor;
      if (element.rotation) compact.r = element.rotation;
      if (element.opacity != null && element.opacity !== 1) compact.o = element.opacity;
      if (element.text) compact.tx = element.text;
      if (element.roughness != null) compact.rg = element.roughness;
      return compact;
    })
  };

  return JSON.stringify(compactState);
};

export const compactDeserialize = (text) => {
  try {
    const compactState = JSON.parse(text);

    // Convert back to full state format
    return {
      canvasWidth: compactState.w,
      canvasHeight: compactState.h,
      elements: compactState.e.map(elem => {
        // Convert abbreviated type back to full name
        let type;
        switch (elem.t) {
          case 'p': type = 'pen'; break;
          case 'e': type = 'eraser'; break;
          case 's': type = 'shape'; break;
          case 't': type = 'text'; break;
          default: type = 'pen';
        }

        // 7.5: Deserialize all compact fields
        const el = {
          type,
          color: elem.c,
          lineWidth: elem.w,
          points: decompressPoints(elem.p)
        };
        if (elem.fc) el.fillColor = elem.fc;
        if (elem.sc) el.strokeColor = elem.sc;
        if (elem.r) el.rotation = elem.r;
        if (elem.o != null) el.opacity = elem.o;
        if (elem.tx) el.text = elem.tx;
        if (elem.rg != null) el.roughness = elem.rg;
        return el;
      })
    };
  } catch (e) {
    console.error('Failed to deserialize compact state:', e);
    return null;
  }
};

// Helper functions for point compression
function compressPoints(points) {
  if (!points || points.length === 0) return [];

  // Use delta encoding for points - store first point as absolute,
  // then only store differences between consecutive points
  const result = [];
  result.push([points[0].x, points[0].y]); // First point absolute

  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i-1].x;
    const dy = points[i].y - points[i-1].y;
    result.push([dx, dy]); // Store deltas
  }

  return result;
}

function decompressPoints(compressedPoints) {
  if (!compressedPoints || compressedPoints.length === 0) return [];

  const result = [];
  // First point is absolute
  result.push({ x: compressedPoints[0][0], y: compressedPoints[0][1] });

  // Reconstruct other points from deltas
  for (let i = 1; i < compressedPoints.length; i++) {
    result.push({
      x: result[i-1].x + compressedPoints[i][0],
      y: result[i-1].y + compressedPoints[i][1]
    });
  }

  return result;
}

/**
 * Planned Discord Integration
 * 
 * For the actual Discord integration, we would need to:
 * 1. Generate a unique channel ID for each student
 * 2. Serialize the whiteboard state
 * 3. Post the serialized state to the hidden text channel
 * 4. Retrieve the latest state when a session is loaded
 */
export const saveToDiscord = async (channelId, state) => {
  // This is a placeholder for the Discord API integration
  console.log(`Saving state to Discord channel ${channelId}`);

  // The real implementation would use Discord API or a backend proxy
  const serializedState = compactSerialize(state);

  // Example API call (not implemented):
  // await discordApi.postMessage(channelId, serializedState);

  return true;
};

export const loadFromDiscord = async (channelId) => {
  // This is a placeholder for the Discord API integration
  console.log(`Loading state from Discord channel ${channelId}`);

  // The real implementation would use Discord API or a backend proxy
  // Example API call (not implemented):
  // const message = await discordApi.getLatestMessage(channelId);
  // const serializedState = message.content;

  // For testing, return a dummy state
  const dummyState = {
    canvasWidth: 1200,
    canvasHeight: 800,
    elements: []
  };

  return dummyState;
};