import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import ToolBar from '@/components/ToolBar.vue';
import TopMenu from '@/components/TopMenu.vue';
import {
  PILOT_ENVIRONMENT,
  featureAvailable,
  resolveManifest,
  pilotAvailability
} from '@/services/pilotSurface';

// The manifest is the single source for what the UI may expose: the toolbar
// buttons must be EXACTLY the manifest's visible tools for the role, and the
// top menu must not contain entries for excluded features.
describe('Pilot surface: manifest-driven UI enumeration', () => {
  const visibleToolbarIds = async (role) => {
    const wrapper = mount(ToolBar, { props: { role } });
    await nextTick();
    const ids = wrapper.findAll('[data-tool-id]').map((btn) => btn.attributes('data-tool-id'));
    wrapper.unmount();
    return ids;
  };

  it('exposes exactly the manifest tools for the teacher role', async () => {
    const manifest = resolveManifest('teacher');
    const ids = await visibleToolbarIds('teacher');
    expect(ids).toEqual(manifest.tools.map((tool) => tool.id));
  });

  it('exposes exactly the manifest tools for the student role (no whole-board clear)', async () => {
    const manifest = resolveManifest('student');
    const ids = await visibleToolbarIds('student');
    expect(ids).toEqual(manifest.tools.map((tool) => tool.id));
    expect(ids).not.toContain('tool.clearBoard');
  });

  it('never renders toolbar entries for excluded experiments or debug', async () => {
    for (const role of ['teacher', 'student']) {
      const ids = await visibleToolbarIds(role);
      expect(ids).not.toContain('experiment.ai');
      expect(ids).not.toContain('experiment.chemistry');
      expect(ids).not.toContain('experiment.gridAlign');
      expect(ids).not.toContain('dev.debugControls');
    }
  });

  it('keeps every release-critical lesson tool visible', async () => {
    const toolbarIds = new Set(await visibleToolbarIds('teacher'));
    for (const critical of [
      'tool.pen',
      'tool.eraser',
      'tool.text',
      'tool.select',
      'tool.pan',
      'tool.shapes',
      'tool.undo',
      'tool.redo',
      'panel.calculator',
      'panel.mathGraph',
      'panel.physicsGraph',
      'panel.coordinateSystem'
    ]) {
      expect(toolbarIds.has(critical), `${critical} must be visible`).toBe(true);
    }
    // Release-critical menu actions (checked through the TopMenu below).
    expect(featureAvailable('panel.inputStyle', 'teacher')).toBe(true);
    expect(featureAvailable('panel.pdfImport', 'teacher')).toBe(true);
    expect(featureAvailable('panel.pdfExport', 'teacher')).toBe(true);
    expect(featureAvailable('panel.imagePaste', 'teacher')).toBe(true);
  });

  it('top menu hides raw board transfer, rooms and grid align while keeping PDF and input style', async () => {
    const wrapper = mount(TopMenu, { props: { role: 'teacher' } });
    // Reveal the gear (hover) and open the menu (click).
    await wrapper.find('.top-menu-container').trigger('mouseenter');
    await nextTick();
    await wrapper.find('.gear-btn').trigger('click');
    await nextTick();

    const labels = wrapper.findAll('.menu-btn span').map((span) => span.text());
    expect(labels).toContain('Pełny ekran');
    expect(labels).toContain('Skróty');
    expect(labels).toContain('Wyczyść'); // teacher may clear the board
    expect(labels).toContain('PDF'); // PDF import + export entries
    expect(labels).toContain('Styl'); // Input Style panel
    expect(labels).not.toContain('Pokoje'); // legacy peer rooms
    expect(labels).not.toContain('Eksport'); // raw JSON board export
    expect(labels).not.toContain('Import'); // raw JSON board import
    expect(labels).not.toContain('Wyrównaj'); // Grid Align
    wrapper.unmount();
  });

  it('top menu hides whole-board clear for the student role', async () => {
    const wrapper = mount(TopMenu, { props: { role: 'student' } });
    await wrapper.find('.top-menu-container').trigger('mouseenter');
    await nextTick();
    await wrapper.find('.gear-btn').trigger('click');
    await nextTick();

    const labels = wrapper.findAll('.menu-btn span').map((span) => span.text());
    expect(labels).not.toContain('Wyczyść');
    wrapper.unmount();
  });
});

describe('Pilot surface: frontend availability adapter', () => {
  it('uses the shared manifest version', () => {
    expect(pilotAvailability.resolve({ environment: 'pilot', role: 'teacher' }).version).toBe(
      'vve.pilot-availability/1'
    );
  });

  it('runs the development environment in tests with the dev surface off by default', () => {
    expect(PILOT_ENVIRONMENT).toBe('development');
    expect(featureAvailable('experiment.ai', 'teacher')).toBe(false);
    expect(featureAvailable('dev.legacyPeerRooms', 'developer')).toBe(false);
    expect(featureAvailable('tool.pen', 'student')).toBe(true);
  });

  it('exposes excluded features only through the intentional dev surface flag', () => {
    expect(featureAvailable('experiment.ai', 'teacher', true)).toBe(true);
    expect(featureAvailable('dev.rawBoardTransfer', 'developer', true)).toBe(true);
  });
});
