// invariant: a fixture that needs a link builds it here. Windows lets a user
// without elevation create symbolic links only in Developer Mode. A directory
// link falls back to a junction, which needs no privilege and which Node and
// the product both see as a link; a file link has no such fallback, so the
// fixture names the setting instead of every test that uses it failing with a
// bare EPERM.
import { symlink } from "node:fs/promises";

export async function linkDirectory(target, path, link = symlink) {
  try {
    await link(target, path, "dir");
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
    await link(target, path, "junction");
  }
}

export async function linkFile(target, path, link = symlink) {
  try {
    await link(target, path);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
    throw new Error(
      "creating a file symbolic link was refused (EPERM): turn on Windows Developer Mode, or run the suite from an elevated session",
      { cause: error }
    );
  }
}
