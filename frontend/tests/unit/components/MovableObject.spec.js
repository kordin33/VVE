import { shallowMount } from '@vue/test-utils';
import { nextTick } from 'vue';
import MovableObject from '@/components/MovableObject.vue';

// The component consumes Pointer Events (pointerdown on the object,
// pointermove/pointerup on document) and commits to the Yjs map on
// pointer UP, so the tests drive that interaction model.
const dispatchPointer = (target, type, coords) => {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, ...coords });
  target.dispatchEvent(event);
  return event;
};

// Mock Y.Map
const createMockYMap = (initialData = {}) => {
  const map = new Map(Object.entries(initialData));
  return {
    _map: map,
    get: vi.fn(key => map.get(key)),
    set: vi.fn((key, value) => {
      map.set(key, value);
    }),
    toJSON: vi.fn(() => Object.fromEntries(map.entries())),
    observe: vi.fn(),
    unobserve: vi.fn(),
    doc: {
      transact: vi.fn((callback) => callback())
    }
  };
};

describe('MovableObject.vue', () => {
  let mockObject;
  let defaultProps;
  let wrapper;

  const initialObjectData = {
    id: 'obj1',
    type: 'rectangle',
    x: 100,
    y: 150,
    width: 200,
    height: 100,
    rotation: 0, // Initial rotation in degrees
    color: 'blue',
    text: 'Hello'
  };

  const createComponent = (props) => {
    return shallowMount(MovableObject, {
      propsData: props,
      global: {
        stubs: {
          // Stub any child components if necessary
        }
      }
    });
  };

  beforeEach(() => {
    mockObject = createMockYMap({ ...initialObjectData });
    defaultProps = {
      object: mockObject,
      isSelected: false,
      zoomLevel: 1,
      panOffset: { x: 0, y: 0 },
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe('Rendering based on isSelected', () => {
    it('should have "is-selected" class and handles when isSelected is true', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      await nextTick();
      expect(wrapper.classes()).toContain('is-selected');
      expect(wrapper.find('.rotation-handle').exists()).toBe(true);
      expect(wrapper.findAll('.resize-handle').length).toBeGreaterThan(0);
    });

    it('should not have "is-selected" class or handles when isSelected is false', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: false });
      await nextTick();
      expect(wrapper.classes()).not.toContain('is-selected');
      expect(wrapper.find('.rotation-handle').exists()).toBe(false);
      expect(wrapper.findAll('.resize-handle').length).toBe(0);
    });
  });

  describe('Selection Request', () => {
    it('emits "request-select" with object id on pointerdown on .object-content when not selected', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: false });
      const contentArea = wrapper.find('.object-content');
      await contentArea.trigger('pointerdown', { clientX: 10, clientY: 10, button: 0 });
      expect(wrapper.emitted('request-select')).toBeTruthy();
      expect(wrapper.emitted('request-select')[0]).toEqual([initialObjectData.id]);
    });

    it('does not emit "request-select" on pointerdown on .object-content when already selected', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const contentArea = wrapper.find('.object-content');
      await contentArea.trigger('pointerdown', { clientX: 10, clientY: 10, button: 0 });
      expect(wrapper.emitted('request-select')).toBeFalsy();
    });
  });

  describe('Drag (Move) Functionality', () => {
    it('updates object position on drag and commits to Yjs on pointerup', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const contentArea = wrapper.find('.object-content');
      const startX = 50;
      const startY = 60;
      const deltaX = 20;
      const deltaY = 30;

      await contentArea.trigger('pointerdown', { clientX: startX, clientY: startY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: startX + deltaX, clientY: startY + deltaY, buttons: 1 });
      await nextTick();

      // Local move feedback is emitted immediately...
      expect(wrapper.emitted('update:object')).toBeTruthy();

      // ...and the Yjs commit happens once the drag ends.
      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      expect(mockObject.doc.transact).toHaveBeenCalled();
      expect(mockObject.set).toHaveBeenCalledWith('x', initialObjectData.x + deltaX);
      expect(mockObject.set).toHaveBeenCalledWith('y', initialObjectData.y + deltaY);
    });

    it('updates object position correctly with zoom', async () => {
      const zoomLevel = 2;
      wrapper = createComponent({ ...defaultProps, isSelected: true, zoomLevel, panOffset: {x: 0, y: 0} });
      const contentArea = wrapper.find('.object-content');
      const startScreenX = 50;
      const startScreenY = 60;
      const deltaScreenX = 40;
      const deltaScreenY = 60;

      await contentArea.trigger('pointerdown', { clientX: startScreenX, clientY: startScreenY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: startScreenX + deltaScreenX, clientY: startScreenY + deltaScreenY, buttons: 1 });
      await nextTick();

      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      const deltaWorldX = deltaScreenX / zoomLevel;
      const deltaWorldY = deltaScreenY / zoomLevel;

      expect(mockObject.doc.transact).toHaveBeenCalled();
      expect(mockObject.set).toHaveBeenCalledWith('x', initialObjectData.x + deltaWorldX);
      expect(mockObject.set).toHaveBeenCalledWith('y', initialObjectData.y + deltaWorldY);
      expect(wrapper.emitted('update:object')).toBeTruthy();
    });
  });

  describe('Resize Functionality (south-east handle)', () => {
    it('updates object dimensions on resize (se handle) and commits on pointerup', async () => {
      wrapper = createComponent({ ...defaultProps, isSelected: true });
      const targetHandle = wrapper.find('.resize-handle.se-handle');
      if (!targetHandle.exists()) throw new Error('SE resize handle (.resize-handle.se-handle) not found');

      const startX = 300;
      const startY = 250;
      const deltaX = 20;
      const deltaY = 15;

      await targetHandle.trigger('pointerdown', { clientX: startX, clientY: startY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: startX + deltaX, clientY: startY + deltaY, buttons: 1 });
      await nextTick();
      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      expect(mockObject.doc.transact).toHaveBeenCalled();
      expect(mockObject.set).toHaveBeenCalledWith('width', initialObjectData.width + deltaX);
      expect(mockObject.set).toHaveBeenCalledWith('height', initialObjectData.height + deltaY);
      expect(wrapper.emitted('update:object')).toBeTruthy();
    });

    it('updates object dimensions correctly with zoom (se handle)', async () => {
      const zoomLevel = 2;
      wrapper = createComponent({ ...defaultProps, isSelected: true, zoomLevel });
      const targetHandle = wrapper.find('.resize-handle.se-handle');
      if (!targetHandle.exists()) throw new Error('SE resize handle (.resize-handle.se-handle) not found for zoom test');

      const startScreenX = 300;
      const startScreenY = 250;
      const deltaScreenX = 40;
      const deltaScreenY = 30;

      await targetHandle.trigger('pointerdown', { clientX: startScreenX, clientY: startScreenY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: startScreenX + deltaScreenX, clientY: startScreenY + deltaScreenY, buttons: 1 });
      await nextTick();
      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      const deltaWorldX = deltaScreenX / zoomLevel;
      const deltaWorldY = deltaScreenY / zoomLevel;

      expect(mockObject.doc.transact).toHaveBeenCalled();
      expect(mockObject.set).toHaveBeenCalledWith('width', initialObjectData.width + deltaWorldX);
      expect(mockObject.set).toHaveBeenCalledWith('height', initialObjectData.height + deltaWorldY);
      expect(wrapper.emitted('update:object')).toBeTruthy();
    });
  });

  describe('Rotation Functionality', () => {
    it('updates object rotation on drag of rotation handle and commits on pointerup', async () => {
      const zoomLevel = 1;
      const panOffset = { x: 0, y: 0 };
      wrapper = createComponent({ ...defaultProps, isSelected: true, zoomLevel, panOffset });
      const rotationHandle = wrapper.find('.rotation-handle');
      expect(rotationHandle.exists()).toBe(true); // Ensure handle is there

      // Object center in screen coordinates
      const objectCenterScreenX = (initialObjectData.x + initialObjectData.width / 2) * zoomLevel - panOffset.x;
      const objectCenterScreenY = (initialObjectData.y + initialObjectData.height / 2) * zoomLevel - panOffset.y;

      // Start dragging directly above the center (-90deg), rotate to the right of the center (0deg):
      // the committed rotation delta is +90 degrees.
      const startMouseScreenX = objectCenterScreenX;
      const startMouseScreenY = objectCenterScreenY - 50;
      const endMouseScreenX = objectCenterScreenX + 50;
      const endMouseScreenY = objectCenterScreenY;

      await rotationHandle.trigger('pointerdown', { clientX: startMouseScreenX, clientY: startMouseScreenY, button: 0 });
      dispatchPointer(document, 'pointermove', { clientX: endMouseScreenX, clientY: endMouseScreenY, buttons: 1 });
      await nextTick();
      dispatchPointer(document, 'pointerup', { button: 0 });
      await nextTick();

      expect(mockObject.doc.transact).toHaveBeenCalled();
      const rotationCall = mockObject.set.mock.calls.find(call => call[0] === 'rotation');
      expect(rotationCall).toBeDefined();
      if (rotationCall) {
        expect(rotationCall[1]).toBeCloseTo(90, 0);
      }
      expect(wrapper.emitted('update:object')).toBeTruthy();
    });
  });
});
