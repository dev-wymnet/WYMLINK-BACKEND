import { Router } from "express";

import {
  loginHandler,
  logoutHandler,
  refreshHandler,
  signupHandler,
  forgotPasswordHandler,
  resetPasswordHandler,
} from "../controller/auth.controller.js";

export const authRoutes = Router();

authRoutes.post("/signup", signupHandler);
authRoutes.post("/login", loginHandler);
authRoutes.post("/refresh", refreshHandler);
authRoutes.post("/logout", logoutHandler);
authRoutes.post("/password/forgot", forgotPasswordHandler);
authRoutes.post("/password/reset", resetPasswordHandler);
