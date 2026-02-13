import { execFile } from "node:child_process";
import streamDeck from "@elgato/streamdeck";

const logger = streamDeck.logger.createScope("iTerm");

const APPLESCRIPT = (tabIndex: number): string => `
tell application "iTerm2"
  activate
  if (count of windows) = 0 then
    create window with default profile
  end if
  tell current window
    set tabCount to count of tabs
    repeat while tabCount <= ${tabIndex}
      create tab with default profile
      set tabCount to tabCount + 1
    end repeat
    select tab ${tabIndex + 1}
  end tell
end tell
`;

export const switchToTab = (slot: number): Promise<boolean> => {
  const tabIndex = slot - 1;

  return new Promise((resolve) => {
    execFile("osascript", ["-e", APPLESCRIPT(tabIndex)], (error) => {
      if (error) {
        if (error instanceof Error) {
          logger.error(`Slot ${slot}: iTerm switch failed: ${error.message}`);
        }
        resolve(false);
        return;
      }
      logger.info(`Slot ${slot}: switched to iTerm tab ${tabIndex}`);
      resolve(true);
    });
  });
};
