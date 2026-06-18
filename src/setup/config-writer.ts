import {
  chmod as fsChmod,
  mkdir as fsMkdir,
  writeFile as fsWriteFile,
} from 'node:fs/promises'
import path from 'node:path'

import type { ConfigFile } from '../config.js'

export function serializeConfig(file: ConfigFile): string {
  return `${JSON.stringify(file, null, 2)}\n`
}

export interface WriteDeps {
  chmod?: (p: string, mode: number) => Promise<void>
  mkdir?: (
    p: string,
    opts: { recursive: boolean },
  ) => Promise<unknown>
  writeFile?: (p: string, data: string) => Promise<void>
}

export async function writeConfigFile(
  filePath: string,
  file: ConfigFile,
  deps: WriteDeps = {},
): Promise<void> {
  const mkdir = deps.mkdir ?? fsMkdir
  const writeFile = deps.writeFile ?? fsWriteFile
  const chmod = deps.chmod ?? fsChmod
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, serializeConfig(file))
  await chmod(filePath, 0o600)
}
