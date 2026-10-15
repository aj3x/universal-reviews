import { openDatabase } from "./client.js";

const path = process.env.DATABASE_PATH ?? "./data/rating.db";
const { sqlite } = openDatabase(path);
sqlite.close();
console.log(`Migrations applied to ${path}`);
