import { Router, type IRouter } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import oauthRouter from "./oauth.js";
import profileRouter from "./profile.js";
import analysesRouter from "./analyses.js";
import chatRouter from "./chat.js";
import progressRouter from "./progress.js";
import achievementsRouter from "./achievements.js";
import subscriptionsRouter from "./subscriptions.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(oauthRouter);
router.use(profileRouter);
router.use(analysesRouter);
router.use(chatRouter);
router.use(progressRouter);
router.use(achievementsRouter);
router.use(subscriptionsRouter);

export default router;
