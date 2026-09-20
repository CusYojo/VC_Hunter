import { AuthFrame } from "@/components/auth/auth-frame";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return <AuthFrame title="登录工作台" description="进入你的项目、今日安排与机构追踪。"><LoginForm /></AuthFrame>;
}
