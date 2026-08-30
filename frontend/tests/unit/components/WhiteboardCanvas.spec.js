import { mount } from '@vue/test-utils';
import { nextTick, ref } from 'vue';
import * as Y from 'yjs';
import WhiteboardCanvas from '@/components/WhiteboardCanvas.vue';
import MovableObject from '@/components/MovableObject.vue';
import { connectToYjs } from '@/services/connectToYjs'; // mocked below

// --- Mocks ---

// The document layer is REAL Yjs (a fresh Y.Doc per test) so the component's
// observe/observeDeep/transaction behavior runs exactly as in production;
// only the network provider is replaced by the connectToYjs mock.
const mockUndoManager = {
  canUndo: ref(false),
  canRedo: ref(false),
  undo: vi.fn(),
  redo: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  destroy: vi.fn(),
  stopCapturing: vi.fn(),
};

const mockAwareness = {
  on: vi.fn(),
  off: vi.fn(),
  clientID: 42,
  getLocalState: vi.fn(() => ({ user: { name: 'Test User', color: '#ff0000' } })),
  setLocalState: vi.fn(),
  setLocalStateField: vi.fn(),
  getStates: vi.fn(() => new Map()),
  destroy: vi.fn(),
};

let mockYDoc;
let mockYDrawings;

vi.mock('@/services/connectToYjs', () => ({
  connectToYjs: vi.fn(() => ({
    ydoc: mockYDoc,
    yDrawings: mockYDrawings,
    awareness: mockAwareness,
    undoManager: mockUndoManager,
    provider: { disconnect: vi.fn(), destroy: vi.fn() },
    disconnect: vi.fn(),
    destroy: vi.fn(),
  })),
}));

// Mock geometry utility
// isPointInRotatedRectangle is crucial for selection
vi.mock('@/utils/geometry', async (importOriginal) => {
  const actual = await importOriginal(); // To get other functions if any
  return {
    ...actual,
    isPointInRotatedRectangle: vi.fn(), // Mock this specific function
  };
});

// happy-dom has no canvas 2d implementation; provide a permissive stub so
// WhiteboardCanvas.initCanvas and the render helpers can run.
const createFake2dContext = () => {
  const target = {};
  const ctx = new Proxy(target, {
    get(obj, prop) {
      if (prop === 'canvas') return { width: 800, height: 600, style: {} };
      if (!(prop in obj)) {
        obj[prop] = () => ctx;
      }
      return obj[prop];
    },
    set() {
      return true;
    }
  });
  return ctx;
};

describe('WhiteboardCanvas.vue', () => {
  let wrapper;
  let initialTestObject; // A real Y.Map inside the real Y.Doc
  let geometryMock; // To control isPointInRotatedRectangle

  beforeEach(async () => {
    vi.clearAllMocks();

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(createFake2dContext());

    geometryMock = await import('@/utils/geometry'); // Get the mocked module

    mockYDoc = new Y.Doc();
    mockYDrawings = mockYDoc.getArray('drawings');
    mockYDoc.transact(() => {
      initialTestObject = new Y.Map();
      initialTestObject.set('id', 'obj1');
      initialTestObject.set('type', 'rectangle');
      initialTestObject.set('x', 50);
      initialTestObject.set('y', 50);
      initialTestObject.set('width', 100);
      initialTestObject.set('height', 80);
      initialTestObject.set('rotation', 0);
      initialTestObject.set('color', 'blue');
      initialTestObject.set('lineWidth', 2);
      mockYDrawings.push([initialTestObject]);
    });

    // Mock connectToYjs to return fresh mocks for each test run
    connectToYjs.mockReturnValue({
        ydoc: mockYDoc,
        yDrawings: mockYDrawings,
        awareness: mockAwareness,
        undoManager: mockUndoManager,
        provider: { disconnect: vi.fn(), destroy: vi.fn() },
        disconnect: vi.fn(),
        destroy: vi.fn(),
    });

    wrapper = mount(WhiteboardCanvas, {
      props: {
        roomId: 'test-room',
      },
      global: {
        // Stubs can be used, but for interaction, sometimes real children are better
        // stubs: { MovableObject: true }
      },
    });
    await nextTick(); // Wait for component mount and yjs connection
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe('Object Selection (right mouse button)', () => {
    it('selects an object on right-button mousedown if hit', async () => {
      // Configure mock to simulate a hit on the object
      geometryMock.isPointInRotatedRectangle.mockReturnValue(true);

      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('mousedown', { clientX: 75, clientY: 90, button: 2 });
      await nextTick();

      expect(geometryMock.isPointInRotatedRectangle).toHaveBeenCalled();
      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.get('id'));

      const movableObjectWrapper = wrapper.findComponent(MovableObject);
      expect(movableObjectWrapper.exists()).toBe(true);
      expect(movableObjectWrapper.props('isSelected')).toBe(true);
    });

    it('does not select an object on right-button mousedown if miss', async () => {
      geometryMock.isPointInRotatedRectangle.mockReturnValue(false); // Simulate a miss

      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('mousedown', { clientX: 10, clientY: 10, button: 2 });
      await nextTick();

      expect(geometryMock.isPointInRotatedRectangle).toHaveBeenCalled();
      expect(wrapper.vm.selectedObjectId).toBeNull();

      const movableObjectWrapper = wrapper.findComponent(MovableObject);
      // If it was previously selected, it should now be deselected. If nothing was selected, it remains not selected.
      if (movableObjectWrapper.exists()) {
        expect(movableObjectWrapper.props('isSelected')).toBe(false);
      }
    });
  });

  describe('Deselection', () => {
    it('deselects the currently selected object on left-click on empty canvas area', async () => {
      // First, select an object
      geometryMock.isPointInRotatedRectangle.mockReturnValue(true);
      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('mousedown', { clientX: 75, clientY: 90, button: 2 }); // Select obj1
      await nextTick();
      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.get('id'));

      // Switch to the select tool, then left-click on empty space (miss)
      wrapper.vm.setTool('select');
      geometryMock.isPointInRotatedRectangle.mockReturnValue(false);
      await canvas.trigger('mousedown', { clientX: 10, clientY: 10, button: 0 }); // Left click outside
      await nextTick();

      expect(wrapper.vm.selectedObjectId).toBeNull();
      const movableObjectWrapper = wrapper.findComponent(MovableObject);
      if (movableObjectWrapper.exists()) {
        expect(movableObjectWrapper.props('isSelected')).toBe(false);
      }
    });
  });

  describe('Interaction propagation to Yjs', () => {
    it('renders MovableObject with the exact Y.Map instance from yDrawings and reacts to its select request', async () => {
      geometryMock.isPointInRotatedRectangle.mockReturnValue(true);
      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      await canvas.trigger('mousedown', { clientX: 75, clientY: 90, button: 2 });
      await nextTick();

      const movableObjectComp = wrapper.findComponent(MovableObject);
      expect(movableObjectComp.exists()).toBe(true);

      // The object handed to MovableObject IS the yDrawings entry, so any
      // set() MovableObject performs lands in the shared document state.
      expect(movableObjectComp.props('object')).toBe(initialTestObject);

      initialTestObject.set('x', 200);
      initialTestObject.set('y', 250);
      expect(mockYDrawings.get(0).get('x')).toBe(200); // Visible through the real yArray
      expect(mockYDrawings.get(0).get('y')).toBe(250);

      // MovableObject requests selection through WhiteboardCanvas wiring.
      await movableObjectComp.vm.$emit('request-select', initialTestObject.get('id'));
      await nextTick();
      expect(wrapper.vm.selectedObjectId).toBe(initialTestObject.get('id'));
    });
  });

  describe('Element drawing to Yjs', () => {
    it('draws a rectangle and commits a Y.Map element to yDrawings', async () => {
      // The real element factory (canvasTools.createNewElement) creates the
      // preview; mouseup commits a real Y.Map inside a ydoc transaction.
      wrapper.vm.setTool('shapes');
      await nextTick();

      const canvas = wrapper.find('.whiteboard-canvas.draw-layer');
      // Simulate drawing: mousedown, mousemove (to define size), mouseup
      await canvas.trigger('mousedown', { clientX: 10, clientY: 20, button: 0 });
      await nextTick(); // Let handleMouseDown process
      // Simulate dragging to (40, 60) to create a 30x40 rectangle
      await canvas.trigger('mousemove', { clientX: 40, clientY: 60, buttons: 1 });
      await nextTick(); // Let handleMouseMove process
      await canvas.trigger('mouseup', { clientX: 40, clientY: 60, button: 0 });
      await nextTick(); // Let handleMouseUp process and element creation

      // The committed element lives in the real yDrawings array.
      const elements = mockYDrawings.toArray();
      expect(elements).toHaveLength(2);
      const pushedElement = elements[1];
      expect(pushedElement).toBeInstanceOf(Y.Map);
      expect(pushedElement.get('type')).toBe('rectangle');
      // Bounding box of start (10,20) -> end (40,60)
      expect(pushedElement.get('x')).toBe(10);
      expect(pushedElement.get('y')).toBe(20);
      expect(pushedElement.get('width')).toBe(30);
      expect(pushedElement.get('height')).toBe(40);
      expect(pushedElement.get('id')).toEqual(expect.any(String));
    });
  });

});
