import type { ReactNode } from "react";
import styles from "./auth.module.css";

export function AuthFrame({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className={styles.page}><section className={styles.card} aria-labelledby="auth-title">
    <div className={styles.brand}>VC HUNTER / INVESTMENT WORKSPACE</div>
    <h1 id="auth-title">{title}</h1><p className={styles.intro}>{description}</p>
    {children}
    <p className={styles.footer}>仅限获邀成员访问。项目、资料与审批记录受账号权限保护。</p>
  </section></main>;
}
