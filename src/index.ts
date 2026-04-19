import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerWorkflowRoutes } from "./http/workflowRoutes.js";
import { AppError } from "./workflow/errors.js";
import {
  registerOnFinalApproval,
  registerOnRejected,
} from "./workflow/callbacks.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });

await registerWorkflowRoutes(app);

registerOnFinalApproval("booking.cancellation_requested", async (p) => {
  app.log.info(
    { ...p },
    "Domain callback: final approval — update booking to cancelled and unit to available"
  );
});

registerOnRejected("booking.cancellation_requested", async (p) => {
  app.log.info(
    { ...p },
    "Domain callback: rejection — notify coordinator (initiator)"
  );
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof AppError) {
    return reply.status(err.httpStatus).send({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    });
  }
  req.log.error(err);
  return reply.status(500).send({
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  });
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

await app.listen({ port, host });
app.log.info(`Listening on http://${host}:${port}`);
