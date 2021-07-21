import { serve } from "https://deno.land/std@0.102.0/http/server.ts";
const body = `data: This is the first message.

data: This is the second message, it
data: has two lines.

data: This is the third message.
`;

const server = serve({ port: 8000 });

for await (const conn of server) {
  conn.respond({
    body: body,
    headers: new Headers([["content-type", "text/event-stream"]]),
  });
}
