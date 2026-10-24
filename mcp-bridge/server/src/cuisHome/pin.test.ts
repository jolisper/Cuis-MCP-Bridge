import { describe, expect, it } from 'vitest';
import {
  CUIS_ARCHIVE_SHA256,
  CUIS_ARCHIVE_TOP_DIR,
  CUIS_ARCHIVE_URL,
  CUIS_CHANGES_FILE,
  CUIS_COMMIT_SHA,
  CUIS_IMAGE_FILE,
  CUIS_LAYOUT_KEY,
  CUIS_RELEASE,
  CUIS_REPO,
  CUIS_SOURCES_FILE,
} from './pin.js';

describe('Cuis pin (invariant 12)', () => {
  it('pins the commit to exactly 40 lowercase hex chars', () => {
    // Given / When
    const sha = CUIS_COMMIT_SHA;

    // Then
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('ships the archive checksum as exactly 64 lowercase hex chars', () => {
    // Given / When
    const checksum = CUIS_ARCHIVE_SHA256;

    // Then
    expect(checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('downloads the pinned commit archive, never a moving branch', () => {
    // Given
    const url = new URL(CUIS_ARCHIVE_URL);

    // When
    const segments = url.pathname.split('/').filter(Boolean);

    // Then
    expect(CUIS_ARCHIVE_URL).toContain(CUIS_COMMIT_SHA);
    expect(CUIS_ARCHIVE_URL).toContain(CUIS_REPO);
    expect(CUIS_ARCHIVE_URL.endsWith('.zip')).toBe(true);
    expect(segments).not.toContain('main');
    expect(segments).not.toContain('master');
    expect(segments).not.toContain(`main.zip`);
    expect(segments).not.toContain(`master.zip`);
  });

  it('derives the layout key from the release and the short commit SHA', () => {
    // Given / When
    const key = CUIS_LAYOUT_KEY;

    // Then
    expect(key).toBe(`${CUIS_RELEASE}-${CUIS_COMMIT_SHA.slice(0, 7)}`);
  });

  it('names the archive top-level directory after the pinned commit', () => {
    // Given / When
    const topDir = CUIS_ARCHIVE_TOP_DIR;

    // Then
    expect(topDir).toContain(CUIS_COMMIT_SHA);
  });

  it('names the image, sources and changes files after the release', () => {
    // Given / When
    const files = [CUIS_IMAGE_FILE, CUIS_SOURCES_FILE, CUIS_CHANGES_FILE];

    // Then
    for (const file of files) {
      expect(file).toContain(CUIS_RELEASE);
    }
  });
});
