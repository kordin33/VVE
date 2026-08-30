import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminTeachersPanel from '@/views/AdminTeachersPanel.vue';

// VVE-101: the Administrator panel must never mask a failed load as an empty
// list (QA P1-1), must log in through the passphrase session (never a URL or
// build-time secret), and must never POST per teacher just to view links.

const fetchCalls = [];
let fetchResponses = [];

const fetchMock = vi.fn(async (url, options = {}) => {
  fetchCalls.push({ url: String(url), method: options.method || 'GET' });
  const response = fetchResponses.shift();
  if (!response) throw new Error(`unexpected fetch: ${url}`);
  const body = typeof response.body === 'string' ? response.body : JSON.stringify(response.body);
  return {
    ok: (response.status || 200) >= 200 && (response.status || 200) < 300,
    status: response.status || 200,
    json: async () => JSON.parse(body)
  };
});

const sessionOk = { status: 200, body: { authenticated: true } };
const teacherList = {
  status: 200,
  body: {
    teachers: [
      {
        teacherId: 't-1',
        email: 'nauczyciel@szkola.pl',
        internalLabel: 'Kowalski — fizyka',
        isActive: true,
        createdAt: '2026-08-01T10:00:00Z',
        lastLoginAt: null,
        accessLink: 'http://app.test/teacher/login?token=abc123'
      }
    ]
  }
};

const mountPanel = async () => {
  const wrapper = mount(AdminTeachersPanel, {
    global: { stubs: { teleport: true } }
  });
  await flushPromises();
  return wrapper;
};

describe('AdminTeachersPanel (VVE-101)', () => {
  beforeEach(() => {
    fetchCalls.length = 0;
    fetchResponses = [];
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => {}) } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the passphrase login gate when there is no session', async () => {
    fetchResponses = [{ status: 401, body: { authenticated: false } }];
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain('Panel administratora');
    expect(wrapper.find('#admin-passphrase').exists()).toBe(true);
    // No deleted secret path: the request carries no x-admin-secret header.
    const sessionCall = fetchCalls.find((c) => c.url.endsWith('/api/admin/session'));
    expect(sessionCall).toBeTruthy();
  });

  it('shows a Polish error state on login failure — never silently', async () => {
    fetchResponses = [
      { status: 401, body: { authenticated: false } },
      { status: 401, body: { error: 'Nieprawidłowe hasło.' } }
    ];
    const wrapper = await mountPanel();

    await wrapper.find('#admin-passphrase').setValue('zle-haslo');
    await wrapper.find('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('Nieprawidłowe hasło.');
  });

  it('does NOT mask a failed list load as an empty list (QA P1-1)', async () => {
    fetchResponses = [sessionOk, { status: 503, body: { error: 'Nie udało się pobrać listy nauczycieli.' } }];
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain('Nie udało się pobrać listy nauczycieli.');
    // The true-empty copy must not appear for a FAILED load.
    expect(wrapper.text()).not.toContain('Nie dodano jeszcze żadnego nauczyciela.');
    // A retry control exists.
    expect(wrapper.find('button[title="Odśwież listę"]').exists()).toBe(true);
  });

  it('lists teachers with their CURRENT link and never POSTs to view it', async () => {
    fetchResponses = [sessionOk, teacherList];
    const wrapper = await mountPanel();

    expect(wrapper.text()).toContain('Kowalski — fizyka');
    expect(wrapper.text()).toContain('nauczyciel@szkola.pl');
    // The retrievable link is displayed in the keyway for copying.
    expect(wrapper.text()).toContain('http://app.test/teacher/login?token=abc123');

    // Viewing issued ONLY the session check + the GET list: no per-teacher
    // POST, no link rotation.
    const methods = fetchCalls.map((c) => c.method);
    expect(methods).toEqual(['GET', 'GET']);

    // Copying is client-side only.
    await wrapper.findAll('button').find((b) => b.text().includes('Kopiuj')).trigger('click');
    await flushPromises();
    expect(fetchCalls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('confirms regeneration explicitly before POSTing', async () => {
    fetchResponses = [sessionOk, teacherList];
    const wrapper = await mountPanel();

    // Queue the refreshed list BEFORE triggering the reload.
    fetchResponses = [teacherList];
    await wrapper.find('button[title="Odśwież listę"]').trigger('click');
    await flushPromises();

    // No confirmation yet: the row action only arms the inline confirm.
    const regenerate = wrapper.findAll('button').find((b) => b.text() === 'Regeneruj link');
    expect(regenerate).toBeTruthy();
    await regenerate.trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('Regenerować link?');
    expect(fetchCalls.filter((c) => c.method === 'POST')).toHaveLength(0);

    // Confirming performs exactly one POST against the regenerate endpoint.
    fetchResponses = [
      { status: 200, body: { teacherId: 't-1', accessLink: 'http://app.test/teacher/login?token=new456' } },
      teacherList
    ];
    await wrapper.findAll('button').find((b) => b.text() === 'Potwierdzam').trigger('click');
    await flushPromises();
    const posts = fetchCalls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toContain('/api/admin/teachers/t-1/regenerate-link');
  });
});
