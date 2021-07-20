import { serve } from "https://deno.land/std@0.102.0/http/server.ts";
const body = `data: This is the first message.

data: This is the second message, it
data: has two lines.

data: This is the third message.`;

const body2 = `event: add
data: 345345345

event: remove
data: 2153

event: add
data: 113411`;

const server = serve({ port: 8000 });

for await (const req of server) {
  req.respond({
    body: req.url === "/2" ? body : body2,
    headers: new Headers([["content-type", "text/event-stream"]]),
  });
}
