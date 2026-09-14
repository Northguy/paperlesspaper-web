import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const googleApisMock = vi.hoisted(() => {
  const oAuth2Client = {
    setCredentials: vi.fn(),
    on: vi.fn(),
  };
  const calendarListList = vi.fn();
  const eventsList = vi.fn();

  return {
    oAuth2Client,
    calendarListList,
    eventsList,
    google: {
      auth: {
        OAuth2: vi.fn(function OAuth2() {
          return oAuth2Client;
        }),
      },
      calendar: vi.fn(() => ({
        calendarList: {
          list: calendarListList,
        },
        events: {
          list: eventsList,
        },
      })),
    },
  };
});

vi.mock("googleapis", () => ({
  google: googleApisMock.google,
}));

import { getCalendarEvents } from "../../src/papers/googleCalendar.service";

describe("googleCalendar.service", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-08T07:00:00.000Z"));

    googleApisMock.oAuth2Client.setCredentials.mockClear();
    googleApisMock.oAuth2Client.on.mockClear();
    googleApisMock.calendarListList.mockReset();
    googleApisMock.eventsList.mockReset();
    googleApisMock.google.auth.OAuth2.mockClear();
    googleApisMock.google.calendar.mockClear();

    googleApisMock.calendarListList.mockResolvedValue({
      data: {
        items: [
          { id: "primary", summary: "Primary" },
          { id: "work.example.com", summary: "Work" },
        ],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the earliest events across selected calendars before applying maxEvents", async () => {
    googleApisMock.eventsList.mockImplementation(async ({ calendarId }) => {
      const eventsByCalendar: Record<
        string,
        Array<{ id: string; summary: string; start: { dateTime: string } }>
      > = {
        primary: [
          {
            id: "primary-mid",
            summary: "Primary mid-morning",
            start: { dateTime: "2026-06-08T10:00:00+02:00" },
          },
          {
            id: "primary-late",
            summary: "Primary late",
            start: { dateTime: "2026-06-08T16:00:00+02:00" },
          },
        ],
        "work.example.com": [
          {
            id: "work-early",
            summary: "Work early",
            start: { dateTime: "2026-06-08T09:00:00+02:00" },
          },
        ],
      };

      return {
        data: {
          items: eventsByCalendar[calendarId] || [],
        },
      };
    });

    const result = await getCalendarEvents({
      meta: {
        googleCalendar: {
          access_token: "access-token",
          refresh_token: "refresh-token",
        },
        selectedCalendars: {
          primary: true,
          "work_%_example_%_com": true,
        },
        dayRange: 1,
        maxEvents: 2,
      },
    });

    expect(result.events.map((event: { id?: string }) => event.id)).toEqual([
      "work-early",
      "primary-mid",
    ]);
    expect(googleApisMock.eventsList).toHaveBeenCalledTimes(2);
    expect(googleApisMock.eventsList).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        calendarId: "primary",
        maxResults: 2,
        orderBy: "startTime",
        singleEvents: true,
      }),
    );
    expect(googleApisMock.eventsList).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        calendarId: "work.example.com",
        maxResults: 2,
        orderBy: "startTime",
        singleEvents: true,
      }),
    );
  });
  it("lists calendars and events with an access token even without a refresh token", async () => {
    googleApisMock.eventsList.mockResolvedValue({ data: { items: [] } });
    const result = await getCalendarEvents({ meta: {
      googleCalendar: { access_token: "access-token" },
      selectedCalendars: { primary: true },
    } });
    expect(result.calendars).toHaveLength(2);
    expect(googleApisMock.eventsList).toHaveBeenCalledOnce();
  });

  it.each([
    ["2026-03-29T00:30:00Z", "2026-03-28T23:00:00.000Z", "2026-03-29T22:00:00.000Z"],
    ["2026-10-25T00:30:00Z", "2026-10-24T22:00:00.000Z", "2026-10-25T23:00:00.000Z"],
  ])("queries only the display day across DST at %s", async (now, timeMin, timeMax) => {
    vi.setSystemTime(new Date(now));
    googleApisMock.eventsList.mockResolvedValue({ data: { items: [] } });
    await getCalendarEvents({
      kind: "google-calendar",
      meta: {
        googleCalendar: { access_token: "access-token" },
        selectedCalendars: { primary: true },
        timezone: "Europe/Berlin", highlightToday: true, dayRange: 30,
      },
    });
    expect(googleApisMock.eventsList).toHaveBeenCalledWith(expect.objectContaining({timeMin, timeMax}));
  });

});
