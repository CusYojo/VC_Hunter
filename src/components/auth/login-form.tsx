"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { authRequest } from "@/auth/client";
import styles from "./auth.module.css";

export function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await authRequest("/sign-in/username", { username, password, rememberMe: false });
      setPassword(""); router.replace("/"); router.refresh();
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(false); }
  }
  return <form className={styles.form} onSubmit={submit}>
    <label className={styles.field}>账号<input type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={(event) => setUsername(event.target.value)} required minLength={2} maxLength={30} /></label>
    <label className={styles.field}>密码<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={128} /></label>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <button className={styles.button} type="submit" disabled={busy}>{busy ? "正在处理…" : "登录工作台"}</button>
    <p className={styles.notice}>账号由管理员开通。忘记密码请联系管理员；本版使用账号和密码登录。</p>
  </form>;
}
