import { readFile } from 'node:fs/promises';
import { Command, CommanderError } from 'commander';

const DEFAULT_FILE = 'data.json';
const EXIT_DATA_ERROR = 1;
const EXIT_USAGE_ERROR = 2;

const TYPE_LABELS = { tram: 'трамвай', trolleybus: 'тролейбус', bus: 'автобус' };
const DAY_TYPES = {
  weekdays: { field: 'weekdayIntervalMinutes', label: 'будні' },
  weekends: { field: 'weekendIntervalMinutes', label: 'вихідні' },
};

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

function findRoute(data, routeId) {
  const route = data.routes.find((r) => r.id.toLowerCase() === routeId.toLowerCase());
  if (!route) {
    const ids = data.routes.map((r) => r.id).join(', ');
    throw new AppError(`маршрут «${routeId}» не знайдено. Доступні маршрути: ${ids}`);
  }
  return route;
}

function parsePositiveInt(value, optionName) {
  if (!/^\d+$/.test(value) || Number(value) === 0) {
    throw new AppError(`значення опції ${optionName} має бути цілим числом більшим за 0, отримано «${value}»`, EXIT_USAGE_ERROR);
  }
  return Number(value);
}

function routeTitle(route) {
  const type = TYPE_LABELS[route.type] ?? route.type;
  return `${route.id} (${type} № ${route.number})`;
}

function getByPath(object, path) {
  const parts = path.split('.');
  let current = object;
  const passed = [];

  for (const part of parts) {
    if (part === '') {
      throw new AppError(`некоректний шлях «${path}»: порожня частина між крапками`, EXIT_USAGE_ERROR);
    }
    const where = passed.length > 0 ? passed.join('.') : 'маршрут';
    if (current === null || typeof current !== 'object') {
      throw new AppError(`поле «${where}» має значення ${JSON.stringify(current)} і не містить вкладених полів`);
    }
    if (Array.isArray(current)) {
      if (!/^\d+$/.test(part)) {
        throw new AppError(`«${where}» є масивом, тому наступна частина шляху має бути індексом (0, 1, ...), отримано «${part}»`);
      }
      const index = Number(part);
      if (index >= current.length) {
        throw new AppError(`у масиві «${where}» немає елемента з індексом ${index} (елементів: ${current.length})`);
      }
      current = current[index];
    } else {
      if (!Object.hasOwn(current, part)) {
        throw new AppError(`поле «${[...passed, part].join('.')}» відсутнє`);
      }
      current = current[part];
    }
    passed.push(part);
  }
  return current;
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

program
  .command('list')
  .description('показати стислий список маршрутів')
  .option('-l, --limit <number>', 'показати не більше вказаної кількості маршрутів')
  .action(async (options, command) => {
    const data = await loadData(getFile(command));
    const limit = options.limit === undefined ? data.routes.length : parsePositiveInt(options.limit, '--limit');
    const routes = data.routes.slice(0, limit);
    for (const route of routes) {
      const type = TYPE_LABELS[route.type] ?? route.type;
      console.log(`${route.id.padEnd(6)} ${type.padEnd(10)} № ${route.number.padEnd(4)} ${route.name}`);
    }
    console.log(`\nПоказано маршрутів: ${routes.length} з ${data.routes.length}`);
  });

program
  .command('show')
  .description('показати всі дані одного маршруту')
  .argument('<routeId>', 'ідентифікатор маршруту, наприклад rt001')
  .action(async (routeId, options, command) => {
    const data = await loadData(getFile(command));
    const route = findRoute(data, routeId);
    console.log(JSON.stringify(route, null, 2));
  });

program
  .command('get')
  .description('показати значення окремого поля маршруту, зокрема вкладеного')
  .argument('<routeId>', 'ідентифікатор маршруту, наприклад rt001')
  .argument('<path>', 'шлях до поля через крапку, індекси масивів — числами (наприклад schedule.weekdayIntervalMinutes або stops.0.name)')
  .action(async (routeId, path, options, command) => {
    const data = await loadData(getFile(command));
    const route = findRoute(data, routeId);
    const value = getByPath(route, path);
    console.log(JSON.stringify(value, null, 2));
  });

program
  .command('stops')
  .description('показати зупинки маршруту по порядку')
  .argument('<routeId>', 'ідентифікатор маршруту, наприклад rt001')
  .option('-c, --coords', 'додати координати зупинок')
  .action(async (routeId, options, command) => {
    const data = await loadData(getFile(command));
    const route = findRoute(data, routeId);
    if (!Array.isArray(route.stops) || route.stops.length === 0) {
      throw new AppError(`для маршруту ${route.id} немає списку зупинок`);
    }
    console.log(`Зупинки маршруту ${routeTitle(route)}:`);
    route.stops.forEach((stop, index) => {
      let line = `${index + 1}. ${stop.name}`;
      if (options.coords) {
        line += ` (${stop.latitude}, ${stop.longitude})`;
      }
      console.log(line);
    });
  });

program
  .command('interval')
  .description('показати інтервал руху маршруту для буднів чи вихідних')
  .argument('<routeId>', 'ідентифікатор маршруту, наприклад rt001')
  .option('-d, --day <type>', 'тип дня: weekdays (будні) або weekends (вихідні)', 'weekdays')
  .action(async (routeId, options, command) => {
    if (!Object.hasOwn(DAY_TYPES, options.day)) {
      throw new AppError(`значення опції --day має бути weekdays або weekends, отримано «${options.day}»`, EXIT_USAGE_ERROR);
    }
    const { field, label } = DAY_TYPES[options.day];
    const data = await loadData(getFile(command));
    const route = findRoute(data, routeId);
    if (!route.schedule || !Object.hasOwn(route.schedule, field)) {
      throw new AppError(`для маршруту ${route.id} немає даних про інтервал на ${label}`);
    }
    const interval = route.schedule[field];
    if (interval === null) {
      console.log(`Маршрут ${routeTitle(route)} у ${label} не курсує.`);
      return;
    }
    console.log(`Маршрут ${routeTitle(route)}, ${label}: інтервал руху ${interval} хв`);
  });

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
