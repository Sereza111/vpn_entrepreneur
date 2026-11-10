import test from "node:test";
import assert from "node:assert/strict";
import { Bot } from "grammy";
import { cabinetSnapshot, cabinetCaption, createCabinet } from "../src/bot/cabinet.js";

const me = {
  subscriptionCheck: "ok", xui: { linked: true },
  subscriptionStatus: { panelStatus: "ACTIVE", expireAt: "2026-12-09T00:00:00Z", usedTrafficBytes: 1234, trafficLimitBytes: 0 },
  balance: { enabled: true, balanceMinor: 12345 },
  subscriptionUrl: "https://secret.example/sub/never-disclose",
  proxy: { password: "never-disclose" },
};
function fixture({ failure, load = async () => me, cards = [], timeout = 8000 } = {}) {
  const calls = [];
  const records = new Map([[123, cards]]);
  const api = {
    getMe: async () => ({ username: "VL_VPNbot" }),
    raw: {
      sendWidget: async p => { calls.push(["widget", p]); if (failure) throw failure; return { message_id: 10 }; },
      answerWidgetQuery: async p => calls.push(["answer", p]),
      editMessageWidgetData: async p => calls.push(["data", p]),
    },
    editMessageText: async (...p) => calls.push(["editText", p]),
    editMessageCaption: async (...p) => calls.push(["caption", p]),
  };
  const store = {
    getCards: async id => records.get(id) || [],
    rememberCard: async (id, card) => records.set(id, [...(records.get(id) || []), card]),
    forgetCard: async () => {},
  };
  const cabinet = createCabinet({ api, loadMe: load, store, webAppUrl: "https://vpn.example/app/", html: "<h3>VL</h3>", log: { warn() {} }, snapshotTimeoutMs: timeout });
  const ctx = {
    from: { id: 123 }, chat: { id: 123, type: "private" }, me: { username: "VL_VPNbot" },
    reply: async (...p) => { calls.push(["text", p]); return { message_id: 11 }; },
    answerCallbackQuery: async () => calls.push(["answerCallback"]),
  };
  const query = (overrides = {}) => ({ ...ctx, update: { widget_query: { id: "q1", from: { id: 123 }, chat: ctx.chat, type: { type: "data" }, message_id: 10, data: "refresh", ...overrides } } });
  return { cabinet, calls, records, ctx, query };
}

test("snapshot contains only permitted presentation fields and never subscription credentials", () => {
  const data = cabinetSnapshot(me, { username: "VL_VPNbot" });
  assert.equal(data.status, "ACTIVE");
  assert.equal(data.balance, 12345);
  assert.equal(JSON.stringify(data).includes("never-disclose"), false);
  assert.ok(Buffer.byteLength(JSON.stringify(data)) <= 1024);
  assert.match(cabinetCaption(data), /Статус доступа не означает/);
});
test("unavailable panel is unknown, not an absent subscription or zero traffic", () => {
  assert.equal(cabinetSnapshot({ subscriptionCheck: "unavailable", xui: { linked: false } }).status, "UNKNOWN");
  assert.equal(cabinetSnapshot({ subscriptionCheck: "ok", xui: { linked: false } }).status, "UNLINKED");
  assert.equal(cabinetSnapshot(null).used, null);
  const data = cabinetSnapshot({ ...me, subscriptionUi: { supportUrl: "https://evil.example/" } });
  assert.equal(data.support, "");
});
test("private start sends widget with useful caption and old-client controls, recording message id", async () => {
  const f = fixture(); await f.cabinet.show(f.ctx);
  const p = f.calls[0][1];
  assert.equal(f.calls[0][0], "widget");
  assert.equal(p.allow_queries, true);
  assert.equal(p.public_data, undefined);
  assert.ok(p.caption.length > 0);
  assert.equal(p.reply_markup.inline_keyboard[2][0].callback_data, "cab:text");
  assert.equal(f.records.get(123)[0].kind, "widget");
});
test("group commands cannot expose private balance or credentials", async () => {
  let reads = 0;const f = fixture({load: async () => { reads++;return me; }});
  await f.cabinet.show({ ...f.ctx, chat: { id: -100, type: "supergroup" } });
  assert.equal(reads, 0);assert.equal(f.calls.length, 0);
});
test("unsupported widget API falls back once, network failure does not create duplicate messages", async () => {
  const f = fixture({ failure: { error_code: 404, description: "Not Found" } });
  await f.cabinet.show(f.ctx);await f.cabinet.show(f.ctx);
  assert.equal(f.calls.filter(c => c[0] === "widget").length, 1);
  assert.equal(f.calls.filter(c => c[0] === "text").length, 2);
  const network = fixture({ failure: new Error("network timeout") });
  await assert.rejects(network.cabinet.show(network.ctx));
  assert.equal(network.calls.filter(c => c[0] === "text").length, 0);
});
test("widget refresh is acknowledged before panel IO and updates only the owned message", async () => {
  let f; f = fixture({ cards: [{ messageId: 10, kind: "widget" }], load: async () => {
    assert.equal(f.calls[0][0], "answer");return me;
  } });
  await f.cabinet.middleware(f.query(), () => assert.fail("not handled"));
  assert.equal(f.calls[1][0], "data");assert.equal(f.calls[1][1].message_id, 10);
});
test("cross-user, shared, unknown message, and unknown command queries never read customer data", async () => {
  let reads=0; const f=fixture({ cards: [{messageId:10,kind:"widget"}], load: async()=>{reads++;return me;} });
  for(const overrides of [{chat:{id:999,type:"private"}}, {chat:{id:123,type:"group"}}, {message_id:99}, {data:"refresh:999"}, {type:{type:"sign_data"}}]) {
    await f.cabinet.middleware(f.query(overrides), () => {});
  }
  assert.equal(reads,0);assert.ok(f.calls.every(c=>c[0]==="answer" && JSON.parse(c[1].data).ok===false));
});
test("post-payment refresh bypasses stale cache, restores bot identity, and sends no new messages", async () => {
  let value=me;const f=fixture({load:async()=>value});await f.cabinet.show(f.ctx);
  value={...me,balance:{enabled:true,balanceMinor:54321}};
  await f.cabinet.refreshUser(123);
  const p=f.calls.find(c=>c[0]==="data")[1];
  assert.equal(JSON.parse(p.chat_data).balance,54321);
  assert.ok(JSON.parse(p.chat_data).app.endsWith("?startapp="));
  assert.equal(f.calls.filter(c=>["widget","text"].includes(c[0])).length,1);
  const restart=fixture({cards:[{messageId:10,kind:"widget"}]});
  await restart.cabinet.refreshUser(123);
  assert.ok(JSON.parse(restart.calls[0][1].chat_data).app.includes("VL_VPNbot"));
});
test("slow panel returns unknown state within the widget response budget", async () => {
  const f=fixture({load:()=>new Promise(()=>{}),timeout:10,cards:[{messageId:10,kind:"widget"}]});
  await f.cabinet.middleware(f.query(),()=>{});
  assert.equal(JSON.parse(f.calls.find(c=>c[0]==="data")[1].chat_data).status,"UNKNOWN");
});
test("simultaneous refreshes of two owned cards update both messages", async () => {
  const f=fixture({cards:[{messageId:10,kind:"widget"},{messageId:12,kind:"widget"}],load:async()=>{await new Promise(r=>setTimeout(r,10));return me;}});
  await Promise.all([f.cabinet.middleware(f.query(),()=>{}), f.cabinet.middleware(f.query({id:"q2",message_id:12}),()=>{})]);
  assert.deepEqual(f.calls.filter(c=>c[0]==="data").map(c=>c[1].message_id).sort(),[10,12]);
});
test("unavailable storage still answers widget query before its deadline", async () => {
  const answers=[];
  const cabinet=createCabinet({api:{raw:{answerWidgetQuery:async p=>answers.push(p)}},loadMe:()=>assert.fail("no read"),webAppUrl:"https://vpn.example/app/",store:{getCards:()=>new Promise(()=>{})},ownershipTimeoutMs:10});
  const f=fixture();await cabinet.middleware(f.query(),()=>{});
  assert.deepEqual(JSON.parse(answers[0].data),{ok:false});
});
test("installed grammy forwards new widget methods and routes widget_query via generic middleware", async () => {
  const bot = new Bot("123:placeholder",{botInfo:{id:123,is_bot:true,first_name:"VL",username:"VL_VPNbot"}});
  const called=[];
  bot.api.config.use(async (_prev, method, payload) => {called.push([method,payload]);return {ok:true,result:true};});
  bot.use(async ctx=>{if(ctx.update.widget_query)await ctx.api.raw.answerWidgetQuery({widget_query_id:ctx.update.widget_query.id,data:'{"ok":true}'});});
  await bot.handleUpdate({update_id:1,widget_query:{id:"q",from:{id:5,is_bot:false,first_name:"User"},data:"refresh",type:{type:"data"}}});
  assert.equal(called[0][0],"answerWidgetQuery");
});
