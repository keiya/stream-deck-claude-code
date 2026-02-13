import streamDeck from "@elgato/streamdeck";
import { SessionStore } from "./state";
import { ClaudeSession } from "./actions/claude-session";
import { ClaudeSessionDial } from "./actions/claude-session-dial";
import { createServer } from "./server";
import { MIN_SLOT, MAX_SLOT } from "./types";

// 1. Create store and restore persisted state
const store = new SessionStore();
const logger = streamDeck.logger.createScope("Plugin");
const restored = store.loadFromDisk();
if (restored > 0) {
  logger.info(`Restored ${restored} slot(s) from disk`);
}

// 2. Wire store to actions
ClaudeSession.setStore(store);
ClaudeSessionDial.setStore(store);

// 3. Register actions
streamDeck.actions.registerAction(new ClaudeSession());
streamDeck.actions.registerAction(new ClaudeSessionDial());

// 4. Subscribe to store updates -> push to all visible actions
store.subscribe((slot, info) => {
  logger.info(`Store update: slot=${slot} state=${info.state}`);
  ClaudeSession.updateSlot(slot, info);
  ClaudeSessionDial.updateSlot(slot, info);
});

// 5. Start HTTP server
createServer(store);

// 6. Connect to Stream Deck
streamDeck.connect();
