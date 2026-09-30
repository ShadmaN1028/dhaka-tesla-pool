import { afterAll, beforeEach } from "vitest";
import { pool } from "../src/db/client";
import { resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(() => pool.end());
