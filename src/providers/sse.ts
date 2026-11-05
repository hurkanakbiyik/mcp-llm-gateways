/**
 * Incremental Server-Sent Events parser. Yields the `data:` payload of each
 * event as soon as its terminating blank line arrives. Holds at most one
 * partial line in memory.
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let pending = "";
  let data: string[] = [];
  for await (const bytes of body) {
    pending += decoder.decode(bytes, { stream: true });
    let nl: number;
    while ((nl = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, nl).replace(/\r$/, "");
      pending = pending.slice(nl + 1);
      if (line === "") {
        if (data.length) yield data.join("\n");
        data = [];
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).replace(/^ /, ""));
      }
    }
  }
  if (data.length) yield data.join("\n");
}
