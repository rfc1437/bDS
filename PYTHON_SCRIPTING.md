# Python Scripting Integration Plan (Electron + Pyodide)

## 1. Overview
This document outlines the architecture for integrating a user-accessible Python scripting engine into the Electron application. The goal is to allow users to write custom scripts stored in the database, which can be executed both interactively and in high-performance batch rendering processes.

## 2. Core Technology: Pyodide
We will use **[Pyodide](https://pyodide.org)** (Python via WebAssembly) as the scripting engine.
- **Security:** Scripts run in a WebAssembly sandbox, protecting the host system.
- **Zero-Dependency:** No local Python installation required on the user's machine.
- **Extensibility:** Support for libraries like `numpy` for heavy data processing.

## 3. Architecture Components

### A. The Scripting Worker (Background Thread)
To ensure the UI remains responsive during "large render-batches," all Python execution will occur in a **Web Worker**.
- **Isolation:** Each script or batch job runs in a dedicated worker.
- **Sync Execution:** Within the worker, Pyodide executes scripts synchronously to minimize the overhead of the JavaScript event loop during loops.

### B. The API Bridge
A bi-directional bridge will expose application internals to the Python environment:
- **`js` module:** Users can `import js` to access exposed APIs.
- **Synchronous Proxies:** Functions required for rendering will be injected into `pyodide.globals` to ensure minimal latency during batch calls.

### C. Data Management (Zero-Copy)
For performance-critical rendering:
- Use **[SharedArrayBuffer](https://developer.mozilla.org)** to share large datasets (e.g., pixel buffers or geometry data) between the main Electron process and the Python Worker.
- Use `pyodide.toPy()` to pass JavaScript objects by reference rather than cloning.

## 4. Implementation Roadmap

### Phase 1: Integration & Setup
- [ ] Integrate `pyodide` NPM package into the Electron Renderer process.
- [ ] Implement a `PythonWorker.js` to initialize the WASM runtime off-main-thread.
- [ ] Create a "Safe-Execute" wrapper that fetches script strings from the database.

### Phase 2: API Surface Definition
- [ ] Define the `AppAPI` object to be exposed to Python.
- [ ] Implement same tools as for API for user scripts (use identical code).
- [ ] Implement tools to use the AI assistant from python scripts
- [ ] Map Python-style snake_case to JavaScript camelCase for a native Python feel.

### Phase 3: Performance Optimization
- [ ] **Script Pre-compilation:** Store compiled `PyCode` objects in memory for batch processing to avoid re-parsing Python code.
- [ ] **Batch Loop:** Implement a high-speed loop in JavaScript that calls the Python `render()` function 10,000+ times without thread-switching.

### Phase 4: User Experience
- [ ] Implement a scripts sidebar that opens a list of stored scripts
- [ ] Integrate a code editor (**Monaco Editor**) with Python syntax highlighting.
- [ ] store scripts like posts in a scripts/ project subfolder. put the frontmatter into a leading python block comment. Extension for python scripts is .py
- [ ] Handle changes the same as with media files, saving a script updates also the file storage
- [ ] also look at script files on rebuild, just like you do for other elements like posts and media. add it to the overall rebuild and add a separate button in preferences where the other buttons are
- [ ] wire the scripts folder also into the metadata diff
- [ ] Add a "Console Output" redirect to capture Python `print()` statements into the UI. Use the bottom panel where tasks and git log show for that, using the "outpout" tab
- [ ] add a run button that fires off a python script

## 7. Rewrite macros into python

- [ ] provide a way to set a script as macro in the editor, keep this fact as metadata
- [ ] convert all existing macros into python scripts
- [ ] keep in mind that scripts can get unquoted content that should be a string still, but fully numeric parameters will be numbers (int or float depending on format)
- [ ] on program start, if no scripts are there, the python scripts are created in the filesystem with default content and loaded into the database
- [ ] version the default scripts in the repository so they can be bundled with the app and propagated to the project

## 6. Security Considerations
- **Resource Limits:** Implement a watchdog timer to terminate Web Workers if a user script enters an infinite loop.
- **Filesystem Access:** Restrict all I/O to the provided application APIs; do not expose Node.js `fs` module to the Pyodide environment.

---
**Status:** Initial Draft  
**Target Performance:** < 1ms overhead per script execution in batch mode.
