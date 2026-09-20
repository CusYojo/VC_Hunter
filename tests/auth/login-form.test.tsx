// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/components/auth/login-form";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, refresh: vi.fn() }) }));
beforeEach(() => { vi.restoreAllMocks(); replace.mockClear(); });
describe("username login form", () => {
  it("supports password-manager fields and enters the workspace", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ user: { username: "vcadmin" } }))));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("账号"), { target: { value: "vcadmin" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-for-test" } });
    fireEvent.click(screen.getByRole("button", { name: "登录工作台" }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });
  it("shows a useful error without exposing the server's raw error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "INVALID_USERNAME_OR_PASSWORD", message: "sensitive internal details" }), { status: 401 })));
    render(<LoginForm />);
    fireEvent.change(screen.getByLabelText("账号"), { target: { value: "vcadmin" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password-for-test" } });
    fireEvent.click(screen.getByRole("button", { name: "登录工作台" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("alert").textContent).toContain("账号或密码不正确");
    expect(screen.queryByText("sensitive internal details")).toBeNull();
  });
});
