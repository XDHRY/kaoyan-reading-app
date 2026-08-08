import { createRouter, publicQuery } from "./middleware";
import { channelRouter } from "./channelRouter";
import { knowledgeRouter, passageRouter, promptRouter } from "./contentRouter";
import { agentRouter } from "./agentRouter";
import { userRouter, vocabRouter, wrongRouter } from "./learnRouter";
import { authRouter } from "./authRouter";
import { methodRouter } from "./methodRouter";
import { adminRouter } from "./adminRouter";
import { insightRouter } from "./insightRouter";
import { essayRouter } from "./essayRouter";
import { exportRouter } from "./exportRouter";
import { retroRouter } from "./retroRouter";
import { ticketRouter } from "./ticketRouter";
import { interactiveRouter } from "./interactiveRouter";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  auth: authRouter,
  method: methodRouter,
  admin: adminRouter,
  channel: channelRouter,
  knowledge: knowledgeRouter,
  passage: passageRouter,
  prompt: promptRouter,
  agent: agentRouter,
  user: userRouter,
  vocab: vocabRouter,
  wrong: wrongRouter,
  insight: insightRouter,
  essay: essayRouter,
  export: exportRouter,
  retro: retroRouter,
  interactive: interactiveRouter,
  ticket: ticketRouter,
});

export type AppRouter = typeof appRouter;
