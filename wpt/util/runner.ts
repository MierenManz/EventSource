// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { readLines } from "https://deno.land/std@0.102.0/io/mod.ts";
import { delay } from "https://deno.land/std@0.102.0/async/mod.ts";
import { DOMParser } from "https://deno.land/x/deno_dom@v0.1.3-alpha2/deno-dom-wasm.ts";
import { assert, denoBinary, ManifestTestOptions, runPy } from "./utils.ts";

export async function runWithTestUtil<T>(
  verbose: boolean,
  f: () => Promise<T>,
): Promise<T> {
  const proc = runPy(["wpt", "serve"], {
    stdout: verbose ? "inherit" : "piped",
    stderr: verbose ? "inherit" : "piped",
  });

  const start = performance.now();
  while (true) {
    await delay(1000);
    try {
      const req = await fetch("http://localhost:8000/");
      await req.body?.cancel();
      if (req.status == 200) {
        break;
      }
    } catch (_err) {
      // do nothing if this fails
    }
    const passedTime = performance.now() - start;
    if (passedTime > 15000) {
      proc.kill(2);
      await proc.status();
      proc.close();
      throw new Error("Timed out while trying to start wpt test util.");
    }
  }

  if (verbose) console.log(`Started wpt test util.`);

  try {
    return await f();
  } finally {
    if (verbose) console.log("Killing wpt test util.");
    proc.kill(2);
    await proc.status();
    proc.close();
  }
}

export interface TestResult {
  cases: TestCaseResult[];
  harnessStatus: TestHarnessStatus | null;
  duration: number;
  status: number;
  stderr: string;
}

export interface TestHarnessStatus {
  status: number;
  message: string | null;
  stack: string | null;
}

export interface TestCaseResult {
  name: string;
  passed: boolean;
  status: number;
  message: string | null;
  stack: string | null;
}

export async function runSingleTest(
  url: URL,
  _options: ManifestTestOptions,
  reporter: (result: TestCaseResult) => void,
): Promise<TestResult> {
  const bundle = await generateBundle(url);
  const tempFile = await Deno.makeTempFile({
    prefix: "wpt-bundle-",
    suffix: ".js",
  });

  try {
    await Deno.writeTextFile(tempFile, bundle);

    const startTime = new Date().getTime();

    const proc = Deno.run({
      cmd: [
        denoBinary(),
        "run",
        "-A",
        "--unstable",
        "--location",
        url.toString(),
        //"--cert",
        //join(ROOT_PATH, `./tools/wpt/certs/cacert.pem`),
        tempFile,
        "[]",
      ],
      env: {
        NO_COLOR: "1",
      },
      stdout: "null",
      stderr: "piped",
    });

    const cases = [];
    let stderr = "";

    let harnessStatus = null;

    const lines = readLines(proc.stderr);
    for await (const line of lines) {
      if (line.startsWith("{")) {
        const data = JSON.parse(line);
        const result = { ...data, passed: data.status == 0 };
        cases.push(result);
        reporter(result);
      } else if (line.startsWith("#$#$#{")) {
        harnessStatus = JSON.parse(line.slice(5));
      } else {
        stderr += line + "\n";
        console.error(line);
      }
    }

    const duration = new Date().getTime() - startTime;

    const { code } = await proc.status();
    return {
      status: code,
      harnessStatus,
      duration,
      cases,
      stderr,
    };
  } finally {
    await Deno.remove(tempFile);
  }
}

async function generateBundle(location: URL): Promise<string> {
  const res = await fetch(location);
  const body = await res.text();
  const doc = new DOMParser().parseFromString(body, "text/html");
  assert(doc, "document should have been parsed");

  // Some tests depend only on `document.title`.
  let documentTitle = "";
  if (doc.getElementsByTagName("title").length > 0) {
    const titleElement = doc.getElementsByTagName("title")[0];
    documentTitle = titleElement.textContent.replace(/[\t\n\f\r ]+/, " ")
      .trim();
  }

  const scripts = doc.getElementsByTagName("script");
  const scriptContents = [];
  let inlineScriptCount = 0;
  for (const script of scripts) {
    const src = script.getAttribute("src");
    if (src === "/resources/testharnessreport.js") {
      const url = new URL("./testharnessreport.js", import.meta.url);
      const contents = await Deno.readTextFile(url);
      scriptContents.push([url.href, contents]);
    } else if (src) {
      const url = new URL(src, location);
      const res = await fetch(url);
      if (res.ok) {
        let contents = await res.text();

        if (src === "/resources/testharness.js") {
          // Some tests need document.title to be present, but if testharness.js
          // detects that `document` exists, it'll assume the test is run in a
          // browser. So here we set document.title *after* the main body of
          // testharness.js
          contents += `\nwindow.document = {title: ${
            JSON.stringify(documentTitle)
          }};\n`;
        }
        scriptContents.push([url.href, contents]);
      }
    } else {
      const url = new URL(`#${inlineScriptCount}`, location);
      inlineScriptCount++;
      scriptContents.push([url.href, script.textContent]);
    }
  }

  const pathToModTs = new URL("../../mod.ts", import.meta.url);
  const setupCode = `
import { EventSource } from ${JSON.stringify(pathToModTs.href)};
window.EventSource = EventSource;
`;

  return setupCode + scriptContents.map(([url, contents]) => `
(function() {
  const [_,err] = Deno.core.evalContext(${JSON.stringify(contents)}, ${
    JSON.stringify(url)
  });
  if (err !== null) {
    throw err?.thrown;
  }
})();`).join("\n");
}
