# Local LLM integration for offline use

I want to implement support for Ollama as another engine to run models, so that I can be fully offline for travel blogging.

1. Core Architecture

Hardware: MacBook Air M4 (16GB Unified Memory).

Inference Engine: Ollama (provides a local OpenAI-compatible REST API).

Primary Model: Qwen2.5-VL-7B (Quantized to 4-bit/q4_K_M).

Why: Best balance between spatial awareness (for alt-text) and memory footprint. Important: it MUST support vision capabilities to create titles, captions and alt-texts for images.

Secondary Model: Gemma 3 4B (for high-speed batch processing).

Decision: which model is better for my usecases?

2. Main Considerations

- fully offline capability
- useable for image titling/captioning/alt-texting
- useable for excerpts, summaries, tab-titling
- useable for AI chat assistant

3. Integration

Ollama is using OpenAI protocols, so should be easy to integrate with AI SDK.

Ollama integration - if activated - must do a check if ollama is serving the model, and if not give a message to the user, so they can fire up ollama, since it won't always be running.
