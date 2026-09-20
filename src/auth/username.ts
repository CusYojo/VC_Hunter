import { z } from "zod";

export const isValidUsername = (value: string) => /^(?:[\p{Script=Han}]{2,30}|[\p{Script=Han}A-Za-z0-9_.]{3,30})$/u.test(value);
export const usernameSchema = z.string().trim().refine(isValidUsername, "Invalid username").transform((value) => value.toLowerCase());
