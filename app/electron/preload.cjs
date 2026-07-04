// Preload script — required for sandbox mode. We deliberately expose NO Node
// APIs to the renderer: everything it needs (WebSocket, IndexedDB, canvas,
// getDisplayMedia) is already available via standard browser APIs, so
// contextBridge stays empty. The file's presence lets us keep sandbox:true
// without breaking preload contract, and gives a clear insertion point
// for future safe IPC helpers.
