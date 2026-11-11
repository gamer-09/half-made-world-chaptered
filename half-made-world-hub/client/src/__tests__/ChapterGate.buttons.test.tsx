import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChapterGate } from '../components/ChapterGate';
import type { ChapterGateApi } from '../hooks/useChapterGate';
import type { GateConfig } from '../chapters/gate';

function makeGate(overrides: Partial<ChapterGateApi> = {}): ChapterGateApi {
  const config: GateConfig = { chapter: -1, uploaded: {} };
  return {
    chapter: -1,
    uploaded: {},
    config,
    upload: vi.fn(),
    reset: vi.fn(),
    ...overrides,
  };
}

function stubFetch(codes: Record<string, number> = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/api/chapter-codes')) {
      return { ok: true, json: async () => codes } as Response;
    }
    return {
      ok: true,
      json: async () => ({ chapterCodes: codes, chapterChecks: {} }),
    } as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('ChapterGate action buttons', () => {
  beforeEach(() => stubFetch({ 'ch1-aaa': 1 }));
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens the upload modal from the Upload a chapter button', () => {
    const onUploadOpenChange = vi.fn();
    render(
      <ChapterGate
        gate={makeGate()}
        stats={null}
        uploadOpen={false}
        onUploadOpenChange={onUploadOpenChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Upload a chapter/i }));
    expect(onUploadOpenChange).toHaveBeenCalledWith(true);
  });

  it('renders the upload modal when uploadOpen is true', () => {
    render(
      <ChapterGate gate={makeGate()} stats={null} uploadOpen onUploadOpenChange={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: /Upload a chapter/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Unlock chapter/i })).toBeTruthy();
  });

  it('offers the redeem route to readers who have no chapter file', () => {
    const onUploadOpenChange = vi.fn();
    render(
      <ChapterGate
        gate={makeGate()}
        stats={null}
        uploadOpen
        onUploadOpenChange={onUploadOpenChange}
      />,
    );

    const alt = document.querySelector('.chapter-upload-alt');
    expect(alt).toBeTruthy();
    expect(alt?.textContent).toMatch(/No chapter file\?/i);
    expect(alt?.textContent).toMatch(/every chapter ends with one/i);

    fireEvent.click(screen.getByRole('button', { name: /Redeem a code/i }));

    expect(onUploadOpenChange).toHaveBeenCalledWith(false);
    expect(screen.getByRole('heading', { name: /Redeem a chapter code/i })).toBeTruthy();
  });

  it('opens the redeem modal independently of the upload modal', () => {
    render(
      <ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Redeem code/i }));

    // The redeem page is its own modal, not nested in the upload modal.
    expect(screen.getByRole('heading', { name: /Redeem a chapter code/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /^Upload a chapter$/i })).toBeNull();
  });

  it('redeems a valid code and unlocks its chapter', async () => {
    const gate = makeGate();
    render(<ChapterGate gate={gate} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    // Wait for the code map to load from the stubbed API.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Redeem code/i }));
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: 'CH1-AAA' } });
    fireEvent.click(screen.getByRole('button', { name: /^Redeem$/i }));

    expect(gate.upload).toHaveBeenCalledWith(1, '');
    expect(screen.getByText(/Unlocked chapter 1/i)).toBeTruthy();
  });

  it('plays the unlock ceremony and then hands the reader back to the archive', async () => {
    const gate = makeGate();
    render(<ChapterGate gate={gate} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Redeem code/i }));
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: 'CH1-AAA' } });

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: /^Redeem$/i }));

    // The ceremony replaces the form: seal, rune rings and a 12-spark burst.
    expect(screen.getByRole('heading', { name: /Chapter 1 unlocked/i })).toBeTruthy();
    expect(document.querySelectorAll('.chapter-unlock-spark').length).toBe(12);
    expect(document.querySelector('.chapter-unlock-seal')).toBeTruthy();
    expect(gate.upload).toHaveBeenCalledWith(1, '');

    // The modal closes itself after the animation so the unlocked archive shows.
    act(() => {
      vi.advanceTimersByTime(3200);
    });
    expect(screen.queryByRole('heading', { name: /Chapter 1 unlocked/i })).toBeNull();
    expect(gate.chapter).toBe(-1); // nothing else was mutated by the ceremony
  });

  it('flags and shakes an unknown code without unlocking anything', () => {
    const gate = makeGate();
    render(<ChapterGate gate={gate} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Redeem code/i }));
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByRole('button', { name: /^Redeem$/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/match any chapter/i);
    expect(screen.getByLabelText(/Code/i).getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.chapter-code-field')?.classList.contains('is-error')).toBe(true);
    expect(gate.upload).not.toHaveBeenCalled();
  });

  it('asks for a code when the field is empty', () => {
    const gate = makeGate();
    render(<ChapterGate gate={gate} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Redeem code/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Redeem$/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/Enter a code first/i);
    expect(gate.upload).not.toHaveBeenCalled();
  });

  it('tells readers where to find a chapter code', () => {
    render(<ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Redeem code/i }));

    expect(screen.getByText(/at the end of every chapter/i)).toBeTruthy();
    // The aside asks readers to keep the code to themselves so others read first.
    expect(screen.getByText(/keep the code to yourself/i)).toBeTruthy();
    expect(screen.getByText(/read the book first/i)).toBeTruthy();
  });

  it('opens the register page and thuds when fields are missing', () => {
    render(<ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Register code/i }));
    expect(screen.getByRole('heading', { name: /Register a chapter code/i })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Register$/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/Enter a code/i);
    expect(screen.getByLabelText(/Code/i).getAttribute('aria-invalid')).toBe('true');
    expect(document.querySelector('.chapter-register-field')?.classList.contains('is-error')).toBe(
      true,
    );
  });

  it('flags the chapter field when only the code is filled', () => {
    render(<ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Register code/i }));
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: 'CH4-SECRET' } });
    fireEvent.click(screen.getByRole('button', { name: /^Register$/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/Enter a chapter number/i);
    expect(screen.getByLabelText('Chapter').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/Code/i).getAttribute('aria-invalid')).toBeNull();
  });

  it('forges a code and stamps it onto the plate', async () => {
    render(<ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Register code/i }));
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: 'CH4-SECRET' } });
    fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: /^Register$/i }));

    // The ceremony replaces the form; its sparks converge instead of bursting.
    expect(await screen.findByRole('heading', { name: /Code forged/i })).toBeTruthy();
    expect(screen.getByText('CH4-SECRET')).toBeTruthy();
    expect(document.querySelectorAll('.chapter-forge-spark').length).toBe(10);
    expect(document.querySelector('.chapter-forge-key')).toBeTruthy();
  });

  it('turns away a code that is already registered', async () => {
    const fetchMock = stubFetch({ 'ch1-aaa': 1 });
    render(<ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Register code/i }));
    await screen.findByText('ch1-aaa');
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: 'CH1-AAA' } });
    fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /^Register$/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/already registered/i);
    expect(screen.getByLabelText(/Code/i).getAttribute('aria-invalid')).toBe('true');
    // Caught before the request: nothing was POSTed.
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('turns away a second code for a chapter that already has one', async () => {
    const fetchMock = stubFetch({ 'ch1-aaa': 1 });
    render(<ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Register code/i }));
    await screen.findByText('ch1-aaa');
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: 'CH1-BBB' } });
    fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Register$/i }));

    expect(screen.getByRole('alert').textContent).toMatch(/Chapter 1 already has a code \(ch1-aaa\)/i);
    expect(screen.getByLabelText('Chapter').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText(/Code/i).getAttribute('aria-invalid')).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('shows a conflict the server reports and flags its field', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/chapter-codes') && init?.method === 'POST') {
        return {
          ok: false,
          json: async () => ({ error: 'Chapter 5 already has a code (ch5-old).', field: 'chapter' }),
        } as Response;
      }
      if (url.includes('/api/chapter-codes')) {
        return { ok: true, json: async () => ({}) } as Response;
      }
      return { ok: true, json: async () => ({ chapterCodes: {}, chapterChecks: {} }) } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Register code/i }));
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: 'CH5-NEW' } });
    fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /^Register$/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/already has a code \(ch5-old\)/i);
    expect(screen.getByLabelText('Chapter').getAttribute('aria-invalid')).toBe('true');
  });

  it('edits a registered code in place', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/chapter-codes')) {
        return {
          ok: true,
          json: async () => (init?.method === 'PUT' ? { ok: true } : { 'ch1-aaa': 1 }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ chapterCodes: { 'ch1-aaa': 1 }, chapterChecks: {} }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Register code/i }));
    fireEvent.click(await screen.findByLabelText('Edit ch1-aaa'));

    expect(screen.getByRole('heading', { name: /Edit chapter code/i })).toBeTruthy();
    expect((screen.getByLabelText(/^Code$/i) as HTMLInputElement).value).toBe('ch1-aaa');

    fireEvent.change(screen.getByLabelText('Chapter'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/chapter-codes/ch1-aaa'),
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    await waitFor(() => expect(screen.getByText('Chapter 7')).toBeTruthy());
  });

  it('deletes a registered code after confirming', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/chapter-codes')) {
        return {
          ok: true,
          json: async () => (init?.method === 'DELETE' ? { ok: true } : { 'ch1-aaa': 1 }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ chapterCodes: { 'ch1-aaa': 1 }, chapterChecks: {} }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<ChapterGate gate={makeGate()} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Register code/i }));
    fireEvent.click(await screen.findByLabelText('Delete ch1-aaa'));

    expect(screen.getByText(/Delete this code\?/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Delete$/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/api/chapter-codes/ch1-aaa'),
        expect.objectContaining({ method: 'DELETE' }),
      ),
    );
    await waitFor(() => expect(screen.queryByText('ch1-aaa')).toBeNull());
  });
});
