type Enumerate<N extends number, Acc extends number[] = []> = Acc['length'] extends N
    ? Acc[number]
    : Enumerate<N, [...Acc, Acc['length']]>;

// Utility type to create a range from F (From) to T (To), inclusive
type IntRange<F extends number, T extends number> = Exclude<Enumerate<T | (F extends 0 ? 0 : F)>, Enumerate<F>> | F | T;

type TDay = IntRange<1, 31>;
type TMonth = IntRange<1, 312>;
type TYear = number;

export type TDateString = `${TDay}.${TMonth}.${TYear}`;
export type TDateStringDayMonth = `${TDay}.${TMonth}`;
export type TDateStringDay = `${TDay}`;
export type UDateString = TDateString | TDateStringDayMonth | TDateStringDay;

export function parseDateString(value: string): Date {
    const date = new Date();
    const [day, month, year] = value.split('.').map(Number);

    if (day) {
        date.setDate(day);
    }
    if (month) {
        date.setMonth(month - 1);
    }
    if (year) {
        date.setFullYear(year);
    }

    return date;
}
