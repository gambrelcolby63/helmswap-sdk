import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Helm } from "@summit-pc/helm";
import { startMock, PAYOUT, USER, WETH, USDC } from "../../helm-sdk/tests/mockServer";
import { createHelmMcpServer } from "../src/server";

let mock: Awaited<ReturnType<typeof startMock>> | null = null;
afterEach(async () => {
  await mock?.close();
  mock = null;
});

async function connect(live = true) {
  mock = await startMock({ live });
  const helm = new Helm({ baseUrl: mock.baseUrl, payoutAddress: PAYOUT });
  const server = createHelmMcpServer({ helm });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" }, { capabilities: {} });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, close: async () => { await client.close(); } };
}

describe("helm-mcp", () => {
  it("lists get_quote and build_swap only (no execute/sign tool)", async () => {
    const { client, close } = await connect();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual(["build_swap", "get_quote"]);
    for (const t of tools.tools) {
      expect(t.name).not.toMatch(/sign|send|broadcast|execute|submit/i);
      expect(t.description).toMatch(/never/i);
    }
    await close();
  });

  it("get_quote returns a disclosed 20% keyless share against the mock API", async () => {
    const { client, close } = await connect();
    const res = await client.callTool({
      name: "get_quote",
      arguments: { chainId: 8453, tokenIn: WETH, tokenOut: USDC, amountIn: "1000000000000000000" },
    });
    const text = (res.content as { type: string; text: string }[])[0].text;
    const body = JSON.parse(text);
    expect(body.feeBps).toBe(10);
    expect(body.referrerShareBps).toBe(2000);
    expect(body.referrer).toBe(PAYOUT);
    expect(body.quoteTicket.sig).toBeTruthy();
    await close();
  });

  it("build_swap returns unsigned evm calldata and userCanSubmit when live", async () => {
    const { client, close } = await connect(true);
    const res = await client.callTool({
      name: "build_swap",
      arguments: { chainId: 8453, tokenIn: WETH, tokenOut: USDC, amountIn: "1000000000000000000", recipient: USER },
    });
    const body = JSON.parse((res.content as { type: string; text: string }[])[0].text);
    expect(body.userCanSubmit).toBe(true);
    expect(body.evmTx.to).toMatch(/^0x/);
    expect(body.evmTx.data).toMatch(/^0x/);
    expect(body.note).toMatch(/Unsigned/);
    await close();
  });

  it("unknown tool and bad chain are errors, not crashes", async () => {
    const { client, close } = await connect();
    const unk = await client.callTool({ name: "execute_swap", arguments: {} });
    expect(unk.isError).toBe(true);
    const bad = await client.callTool({ name: "get_quote", arguments: { chain: "optimism", tokenIn: WETH, tokenOut: USDC, amountIn: "1" } });
    expect(bad.isError).toBe(true);
    await close();
  });
});
