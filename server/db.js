import "dotenv/config";
import mysql from "mysql2/promise";

// A shared connection pool. mysql2's promise API lets us use async/await
// and its placeholder syntax (?) guards against SQL injection.
export const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "helpdesk",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Small helper so routes can run a query and get rows back directly.
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
