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
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
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

  it('shows an error for an unknown code without unlocking anything', () => {
    const gate = makeGate();
    render(<ChapterGate gate={gate} stats={null} uploadOpen={false} onUploadOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Redeem code/i }));
    fireEvent.change(screen.getByLabelText(/Code/i), { target: { value: 'NOPE' } });
    fireEvent.click(screen.getByRole('button', { name: /^Redeem$/i }));

    expect(screen.getByText(/Unknown code/i)).toBeTruthy();
    expect(gate.upload).not.toHaveBeenCalled();
  });
});
