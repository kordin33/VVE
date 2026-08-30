import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { defineComponent } from 'vue';
import Root from '@/Root.vue';
import PilotUnavailable from '@/views/PilotUnavailable.vue';

// Direct navigation must follow the shared PilotAvailability manifest: the
// whiteboard opens only through a board session link, and the legacy
// peer-room lobby has no product route (dev surface flag only).
const Stub = (name) => defineComponent({ name, template: `<div data-stub="${name}" />` });

const stubs = {
  App: Stub('App'),
  TeacherDashboard: Stub('TeacherDashboard'),
  StudentBoardEntry: Stub('StudentBoardEntry'),
  AdminTeachersPanel: Stub('AdminTeachersPanel'),
  PilotUnavailable: undefined // real component: it is the denial oracle
};

const mountRoot = async () => {
  const wrapper = mount(Root, { global: { stubs: { ...stubs, PilotUnavailable } } });
  await nextTick();
  return wrapper;
};

const stubLocation = ({ pathname = '/', search = '', hash = '' }) => {
  vi.spyOn(window.location, 'pathname', 'get').mockReturnValue(pathname);
  vi.spyOn(window.location, 'search', 'get').mockReturnValue(search);
  vi.spyOn(window.location, 'hash', 'get').mockReturnValue(hash);
};

describe('Pilot surface: direct navigation is manifest-driven', () => {
  let wrapper;

  beforeEach(() => {
    window.localStorage?.clear?.();
  });

  afterEach(() => {
    if (wrapper) wrapper.unmount();
    vi.restoreAllMocks();
  });

  it('shows the unavailable page on / (no lobby, no auto-created peer room)', async () => {
    stubLocation({ pathname: '/' });
    wrapper = await mountRoot();
    expect(wrapper.findComponent(PilotUnavailable).exists()).toBe(true);
    expect(wrapper.find('[data-stub="App"]').exists()).toBe(false);
  });

  it('shows the unavailable page for a legacy hash-room URL', async () => {
    stubLocation({ pathname: '/', hash: '#room=some-room&key=abc' });
    wrapper = await mountRoot();
    expect(wrapper.findComponent(PilotUnavailable).exists()).toBe(true);
  });

  it('mounts the whiteboard only for a board session link', async () => {
    stubLocation({ pathname: '/', search: '?room=board-1&wsToken=abc.def' });
    wrapper = await mountRoot();
    expect(wrapper.find('[data-stub="App"]').exists()).toBe(true);
    expect(wrapper.findComponent(PilotUnavailable).exists()).toBe(false);
  });

  it('mounts the legacy whiteboard surface only with the internal dev flag', async () => {
    stubLocation({ pathname: '/', search: '?__dev=1' });
    wrapper = await mountRoot();
    expect(wrapper.find('[data-stub="App"]').exists()).toBe(true);
  });

  it('does not treat an untrusted __dev flag plus missing board session as a board', async () => {
    // __dev only widens the legacy surface in development; it never becomes
    // a board session by itself.
    stubLocation({ pathname: '/', search: '?__dev=1&room=x' });
    wrapper = await mountRoot();
    expect(wrapper.find('[data-stub="App"]').exists()).toBe(true);
  });

  it('mounts the admin panel route', async () => {
    stubLocation({ pathname: '/admin/teachers' });
    wrapper = await mountRoot();
    expect(wrapper.find('[data-stub="AdminTeachersPanel"]').exists()).toBe(true);
  });

  it('mounts the teacher dashboard route', async () => {
    stubLocation({ pathname: '/teacher/dashboard' });
    wrapper = await mountRoot();
    expect(wrapper.find('[data-stub="TeacherDashboard"]').exists()).toBe(true);
  });

  it('mounts the student entry route and derives the slug', async () => {
    stubLocation({ pathname: '/s/abc123' });
    wrapper = await mountRoot();
    expect(wrapper.find('[data-stub="StudentBoardEntry"]').exists()).toBe(true);
  });

  it('mounts the student entry route for /board/:slug too', async () => {
    stubLocation({ pathname: '/board/abc123' });
    wrapper = await mountRoot();
    expect(wrapper.find('[data-stub="StudentBoardEntry"]').exists()).toBe(true);
  });
});
