import dotenv from "dotenv";
import path from "path";

// Load the server .env so DB/auth env vars are available in integration tests
dotenv.config({
  path: path.resolve(
    import.meta.dirname,
    "../../../../apps/server/.env",
  ),
});
