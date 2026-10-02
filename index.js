import { readFile } from 'node:fs/promises';
import { Command, CommanderError } from 'commander';

const DEFAULT_FILE = 'data.json';
const EXIT_DATA_ERROR = 1;
const EXIT_USAGE_ERROR = 2;

class AppError extends Error {
  constructor(message, exitCode = EXIT_DATA_ERROR) {
    super(message);
    this.exitCode = exitCode;
  }
}

async function loadData(filePath) {
  let text;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') throw new AppError(`файл «${filePath}» не знайдено`);
    if (err.code === 'EISDIR') throw new AppError(`«${filePath}» є текою, а не файлом`);
    if (err.code === 'EACCES') throw new AppError(`немає доступу до файлу «${filePath}»`);
    throw new AppError(`не вдалося прочитати файл «${filePath}»`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new AppError(`файл «${filePath}» містить некоректний JSON`);
  }

  if (data === null || typeof data !== 'object' || !Array.isArray(data.routes)) {
    throw new AppError(`файл «${filePath}» не має очікуваної структури (потрібен масив routes)`);
  }
  return data;
}

function getFile(command) {
  return command.optsWithGlobals().file;
}

const program = new Command();

program
  .name('transport')
  .description('Довідник маршрутів міського транспорту: дані читаються з JSON-файлу')
  .version('1.0.0', '-V, --version', 'показати версію програми')
  .helpOption('-h, --help', 'показати довідку')
  .helpCommand('help [command]', 'показати довідку для команди')
  .option('-f, --file <path>', 'шлях до JSON-файлу з даними', DEFAULT_FILE)
  .configureHelp({ showGlobalOptions: true })
  .exitOverride()
  .configureOutput({ outputError: () => {} });

function translateCommanderError(err) {
  const quoted = err.message.match(/'([^']+)'/)?.[1] ?? '';
  switch (err.code) {
    case 'commander.unknownOption':
      return `невідома опція «${quoted}»`;
    case 'commander.unknownCommand':
      return `невідома команда «${quoted}»`;
    case 'commander.missingArgument':
      return `не вказано обов'язковий аргумент «${quoted}»`;
    case 'commander.optionMissingArgument':
      return `для опції «${quoted}» не вказано значення`;
    case 'commander.excessArguments':
      return `забагато аргументів для команди «${quoted}»`;
    default:
      return 'некоректний виклик програми';
  }
}

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode === 0) {
        return;
      }
      if (err.code === 'commander.help') {
        console.error('Помилка: не вказано команду');
      } else {
        console.error(`Помилка: ${translateCommanderError(err)}. Довідка: --help`);
      }
      process.exitCode = EXIT_USAGE_ERROR;
      return;
    }
    if (err instanceof AppError) {
      console.error(`Помилка: ${err.message}`);
      process.exitCode = err.exitCode;
      return;
    }
    console.error(`Непередбачена помилка: ${err.message}`);
    process.exitCode = EXIT_DATA_ERROR;
  }
}

main();
