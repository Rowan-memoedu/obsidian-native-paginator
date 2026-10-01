interface ReadingFileState {
  enabledFiles: Record<string, boolean>;
  positions: Record<string, number>;
}

/** Follow a file or folder move without overwriting an existing destination choice. */
export function moveReadingFileState(
  state: ReadingFileState,
  oldPath: string,
  newPath: string,
): boolean {
  if (oldPath === newPath) return false;
  let changed = false;
  const moveEntries = <T>(entries: Record<string, T>): void => {
    for (const path of Object.keys(entries)) {
      if (path !== oldPath && !path.startsWith(`${oldPath}/`)) continue;
      const destination = newPath + path.slice(oldPath.length);
      if (!Object.prototype.hasOwnProperty.call(entries, destination)) {
        entries[destination] = entries[path]!;
      }
      delete entries[path];
      changed = true;
    }
  };
  moveEntries(state.enabledFiles);
  moveEntries(state.positions);
  return changed;
}
