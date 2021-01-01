import {
  buildExecutable,
  callExpression,
  CanonicalName,
  Closure,
  expressionStatement,
  identifier,
  memberExpression,
  stringLiteral,
} from "@depno/core";
import { forkProgram } from "@depno/host";
import { Map } from "@depno/immutable";
import { ChildProcess } from "child_process";
import { symlinkSync, unlinkSync } from "fs";
import { resolve } from "path";
import { inMemoryHost } from "../in_memory_host/$.ts";
import { closure } from "../macros/closure.ts";
import { replaceDefinitions } from "../replaceDefinitions/$.ts";
import { runScenarios } from "../validator/runScenarios.ts";
import { getExecutionProgramForDefinition } from "./executeExpressionWithScope/getExecutionProgramForDefinition/$.ts";
import { depnoSpec } from "./spec/index.ts";

export async function build() {
  await buildExecutable(
    closure(async (argv: string[]) => {
      const fileToRun = argv[2];
      const exportedFunctionName = argv[3];
      const parameters = argv.slice(4);

      await runFile(fileToRun, {
        exportedFunctionName,
        args: parameters.map((x) => {
          if (x === "{stdin}") {
            return "__stdin__";
          } else if (x === "{stdout}") {
            return "__stdout__";
          } else {
            return JSON.parse(x);
          }
        }),
        silent: false,
      });
    }),
    {
      target: "host",
      output: "target/opah",
    }
  );
  unlinkSync("opah");
  symlinkSync("./target/opah", "opah");
}

export function test() {
  const inMemorySpec = replaceDefinitions(depnoSpec, inMemoryHost);
  runScenarios(inMemorySpec);
}

async function runFile(
  path: string,
  opts: {
    exportedFunctionName?: string;
    args?: any[];
    cwd?: string;
    silent?: boolean;
  } = {}
): Promise<ChildProcess> {
  const silent = opts.silent ?? true;
  const args = opts.args ?? [];
  const exportedFunctionName = opts.exportedFunctionName ?? "default";
  const uri = path.startsWith(".")
    ? resolve(opts.cwd || process.cwd(), path)
    : path;

  const functionCanonicalName = CanonicalName({
    uri,
    name: exportedFunctionName,
  });

  return executeCanonicalName(functionCanonicalName, args, {
    cwd: opts.cwd,
    silent,
  });
}

export async function executeCanonicalName(
  canonicalName: CanonicalName,
  args: any[] = [],
  opts: {
    cwd?: string;
    silent?: boolean;
  } = {
    silent: true,
  }
) {
  const mappedArgs = args.map((x) => {
    if (x === "__stdin__") {
      return memberExpression(identifier("process"), identifier("stdin"));
    } else if (x === "__stdout__") {
      return memberExpression(identifier("process"), identifier("stdout"));
    } else {
      return stringLiteral(typeof x === "string" ? x : JSON.stringify(x));
    }
  });

  const mainFunctionName = "main";

  const { expression } = expressionStatement(
    callExpression(identifier(mainFunctionName), mappedArgs)
  );

  const program = await getExecutionProgramForDefinition(
    Closure({
      expression,
      references: Map([[mainFunctionName, canonicalName]]),
    })
  );

  return forkProgram(program, opts.cwd || process.cwd());
}
