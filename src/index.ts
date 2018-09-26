interface datePickerOptions {
  el: string | HTMLElement;
  limit?: number;
  format?: string;
  views?: number | string;
  startDate?: Date;
  endDate?: Date;
  selection?: number;
}

interface disable {
  dates?: Array<any>;
  days?: Array<number>;
  to?: Date | string;
  from?: Date | string;
}

import {
  attr,
  isDate,
  isArray,
  isUndefined,
  parseToInt,
  listHead,
  listTail,
  $,
  dedupList,
  isDef
} from "./util";
import template from "./datepicker.template";
import {
  getViews,
  parseEl,
  Observer,
  parse,
  format,
  setDate,
  diff,
  getDates,
  getMonthsByYear,
  getYearsByDate,
  createDate,
  createNodeClassName,
  findDiableDates,
  findDisableInQueue,
  defaultLanguage,
  containerClassName,
  checkPickableDate,
  formatParse
} from "./datepicker.helpers";
import { Queue } from "./datepicker.queue";

const emitter = event => (type, value) =>
  Observer.$emit(event, { type, value });
let queue = null;

export default class TypePicker {
  protected setState<Function>(state: any | Function, next?: Function | any) {
    if (typeof state === "function") {
      this.state = state(this.state);
    } else {
      this.state = {
        ...this.state,
        ...state
      };
    }

    setTimeout(() => {
      this.render(next);
    }, 0);
  }

  private state: any = {
    bindData: false,
    selection: <number>1,
    views: <number | string>1,
    date: <Date>new Date(),
    startDate: <Date>null,
    endDate: <Date>null,
    data: <any>{},
    reachEnd: <boolean>false,
    reachStart: <boolean>false,
    dateFormat: <string>null,
    limit: <number>1,
    disables: <any[]>[],
    language: <any>defaultLanguage
  };

  static diff = diff;
  private element: any = null;

  public on = Observer.$on;
  public format = (date: Date) => format(date, this.state.dateFormat);
  public parse = (date: string | Date) => parse(date, this.state.dateFormat);

  public setDates(dates: Array<any>) {
    if (!isArray(dates)) return;
    let datesList: Array<any> = [];
    let start: string = "",
      end: string = "";

    const { selection, limit } = this.state;
    if (selection !== 2) {
      for (let item of dates) {
        if (!this.inDisable(item)) {
          datesList.push(item);
        }
      }
    } else {
      if (dates.length < selection) {
        return;
      } else if (dates.length > selection) {
        dates = dates.slice(0, selection);
      }
      let [start, end] = dates;
      if (!isDate(start)) {
        start = this.parse(start);
      }

      if (!isDate(end)) {
        end = this.parse(end);
      }

      let gap = diff(end, start, "days", true);

      if (gap > limit || end < start) {
        return;
      }
      start = this.format(start);
      end = this.format(end);
      if (this.inDisable(start)) {
        return;
      }
      datesList = [start, end].filter(isDef);
    }

    for (let item of datesList) {
      this.enqueue(item);
    }
  }

  private createTemplate() {
    const {
      date,
      dateFormat,
      views,
      endDate,
      startDate,
      selection
    } = this.state;
    const format = this.format;

    const monthSize =
      views == 2 ? 1 : views === "auto" ? diff(endDate, startDate) : 0;
    const template = [];
    for (let i = 0; i <= monthSize; i++) {
      let dat = new Date(date.getFullYear(), date.getMonth() + i, 1);
      let dates = getDates(dat.getFullYear(), dat.getMonth());
      template.push({
        dates,
        year: dat.getFullYear(),
        month: dat.getMonth()
      });
    }

    const range = ((queue, selection) => {
      if (!queue || queue.length <= 0) {
        return [];
      }
      if (selection > 2) {
        return queue;
      }
      let start = this.parse(queue[0]);
      let end = this.parse(queue[queue.length - 1]);
      return createDate({
        date: start,
        days: diff(end, start, "days"),
        dateFormat: dateFormat
      });
    })(queue.list, selection);

    return template.map((item: any) => {
      let heading = this.state.language.title(item.year, item.month);

      let dates = {};
      let firstDay = new Date(item.year, item.month, 1);
      let lastMonthDates = new Date(item.year, item.month, 0).getDate();

      for (let i = 0; i < firstDay.getDay(); i++) {
        let lateMonthDate: Date = new Date(
          item.year,
          item.month - 1,
          lastMonthDates - i
        );
        dates[format(lateMonthDate)] = {
          date: false,
          day: false,
          className: "disabled empty"
        };
      }
      for (let i = 0; i < item.dates; i++) {
        let date = new Date(item.year, item.month, i + 1);
        let formatted = format(date);
        dates[formatted] = {
          date: date.getDate(),
          day: date.getDay(),
          className: createNodeClassName({
            date: formatted,
            dates: range,
            onlyActive: selection !== 2
          })
        };
      }
      return {
        heading,
        year: item.year,
        month: item.month,
        dates
      };
    });
  }

  private render(next: Function | undefined) {
    const {
      views,
      reachStart,
      reachEnd,
      language: { week }
    } = this.state;

    this.element.innerHTML = template({
      data: this.createTemplate(),
      week,
      extraPanel: null,
      reachStart: reachStart,
      reachEnd: reachEnd,
      renderWeekOnTop: views === "auto"
    });
    this.afterRender(next);
  }

  private inDisable(date: string) {
    return this.state.disables.indexOf(date) >= 0;
  }

  private afterRender(after: Function | undefined) {
    const {
      dateFormat,
      selection,
      date,
      reachStart,
      reachEnd,
      endDate,
      disables,
      startDate
    } = this.state;

    typeof after === "function" && after(this.state);
    //日期切换
    const dom = selector => $(this.element, selector);

    const nodeList = dom(".calendar-cell");
    const prevActionDOM = dom(".calendar-action-prev");
    const nextActionDOM = dom(".calendar-action-next");

    const updater = (date: Date, start, end) => {
      return setState => size => {
        const now = setDate(date, size, "month");
        const endGap = end ? diff(end, now) : 1;
        const startGap = end ? diff(now, start) : 2;
        const reachStart = startGap < 1 && endGap >= 0;
        const reachEnd = startGap > 1 && endGap <= 1;
        const states = {
          reachEnd,
          reachStart,
          date: now
        };

        setState(states);
      };
    };

    const update = updater(date, startDate, endDate)(this.setState.bind(this));

    if (prevActionDOM && nextActionDOM) {
      prevActionDOM.addEventListener("click", () => !reachStart && update(-1));
      nextActionDOM.addEventListener("click", () => !reachEnd && update(1));
    }

    Observer.$emit("disabled", {
      nodeList,
      dateList: disables
    });

    const inDisable = date => this.inDisable(date);
    for (let i = 0; i < nodeList.length; i++) {
      nodeList[i].addEventListener("click", () => {
        const date = attr(nodeList[i], "data-date");
        const pickable = checkPickableDate({
          date,
          queue: queue.list,
          dateFormat,
          selection,
          inDisable,
          limit: this.state.limit
        });
        if (pickable) this.enqueue(date);
      });
    }
  }

  public setDisabled({ to, from, days, dates }: disable) {
    const { endDate, startDate } = this.state;
    const { parse, format } = this;

    const filterDay = day => {
      day = parseInt(day);
      return !isNaN(day) && day >= 0 && day <= 6;
    };

    let state = <any>{
      startDate
    };

    let dateList = [];

    if (isDate(from)) {
      state.endDate = from;
    } else {
      const parsed = this.parse(<string>from);
      if (isDate(parsed)) {
        state.endDate = parsed;
      }
    }
    if (isDate(to)) {
      state.startDate = to;
    } else {
      const parsed = this.parse(<string>to);
      if (isDate(parsed)) {
        state.startDate = setDate(parsed);
      }
    }

    if (state.startDate) {
      state.reachStart = true;
      state.date = state.startDate;
    }

    if (isArray(dates)) {
      dateList = dates.map(formatParse(parse)(format)).filter(isDef);
    }

    if (isArray(days)) {
      const mapDateByDay = days => {
        return date => {
          if (days.indexOf(date.getDay()) >= 0) {
            return this.format(date);
          }
          return null;
        };
      };
      const startDateMonthFirstDate = new Date(
        state.startDate.getFullYear(),
        state.startDate.getMonth(),
        1
      );
      let dates = createDate({
        date: startDateMonthFirstDate,
        days: diff(endDate, startDateMonthFirstDate, "days")
      });
      if (isArray(dates)) {
        dates = dates.map(mapDateByDay(days.filter(filterDay))).filter(isDef);
        dateList = [...dateList, ...dates];
      }
    }
    state.disables = dedupList(dateList);
    this.setState(state);
  }

  private enqueue(value) {
    const { selection, bindData } = this.state;
    const next = queue.enqueue(value);
    const afterEnqueue = () => {
      const dateFormat = this.state.dateFormat;
      const includeDisabled = findDisableInQueue(
        queue.list,
        dateFormat,
        this.inDisable.bind(this)
      );

      if (includeDisabled && selection === 2) {
        if (this.inDisable(value)) {
          queue.pop();
        } else {
          queue.shift();
        }
      }

      const createEmitter = () => emitter("update")("selected", queue.list);
      this.render(createEmitter);
    };

    next(afterEnqueue);
  }

  private create() {
    let states: any = {
      disables: {}
    };
    const bindData = this.state.bindData;
    //去掉data里的无效日期
    const validateData = ({ disables, data, startDate, endDate }) => {
      let output = {
        disables,
        data,
        endDate
      };

      //此处未排序日期，直接取this.data的最后一个key
      //排序在setData里做

      if (bindData) {
        let gap = diff(startDate, endDate, "days", true);

        for (let i = 0; i < gap; i++) {
          let date = this.format(setDate(startDate, i));
          if (isUndefined(data[date])) {
            disables[date] = date;
          } else {
            delete data[date];
          }
        }
        endDate = this.parse(listTail(Object.keys(data)));
        output.data = data;
        output.endDate = endDate;
      } else {
        output.data = {};
      }

      return output;
    };

    const setViewDate = () => {
      if (queue.list.length > 0) {
        return this.parse(listHead(queue.list));
      } else {
        return this.state.startDate ? new Date() : this.state.startDate;
      }
    };
    const { disables, data, endDate } = validateData(this.state);

    if (endDate) {
      states.endDate = endDate;
    }
    this.setState({
      ...states,
      date: setViewDate()
      // data: data
    });
  }

  constructor(option: datePickerOptions) {
    if (!option || !parseEl(option.el)) {
      return;
    }

    this.element = parseEl(option.el);
    let states: any = {
      selection: option.selection || 1,
      dateFormat: option.format,
      views: getViews(option.views)
    };

    if (isDate(option.startDate)) {
      states.startDate = option.startDate;
      states.reachStart = true;
    }
    if (isDate(option.endDate)) {
      states.endDate = option.endDate;
    }
    if (option.limit) {
      states.limit = option.limit ? option.limit : 1;
    }

    this.element.className = containerClassName(
      this.element.className,
      states.views
    );
    this.state = {
      ...this.state,
      ...states
    };
    queue = new Queue({
      size: this.state.selection,
      limit: this.state.selection === 2 ? this.state.limit : false,
      dateFormat: this.state.dateFormat
    });
    this.create();
  }
}
