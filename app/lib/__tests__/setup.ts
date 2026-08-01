import { afterEach } from "vitest";
import { closeAllTestClients } from "./helpers";

afterEach(async () => {
  await closeAllTestClients();
});
