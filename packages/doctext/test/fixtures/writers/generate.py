"""
THE WRITER CORPUS: one small file per format per open-source producer, so a reader is tested against what real
writers emit rather than against XML we wrote by hand. A reader that reads Excel's attribute order and misses
openpyxl's is exactly the bug this exists to catch (a workbook read as its sheet names alone).
Every file's content is invented: no person, company, figure or record in it is real.

Run from this directory with a venv holding the writers (versions are recorded in manifest.json):

    python3 -m venv /tmp/writers && /tmp/writers/bin/pip install openpyxl xlsxwriter python-docx python-pptx icalendar webvtt-py
    /tmp/writers/bin/python generate.py            # every producer
    /tmp/writers/bin/python generate.py icalendar  # only the ones named, merged into manifest.json

Then `UPDATE_GOLDEN=1 pnpm --filter @louvain/doctext test` writes each file's golden reading. Every value is
throwaway text. Files a person saves here from Excel, Word, PowerPoint, LibreOffice or Google are picked up by
the same test (`writers.test.ts`) without a line of code: name the producer in the filename.
"""

import datetime
import json
import sys

import docx
import openpyxl
import openpyxl.styles
import pptx
import xlsxwriter

HEADER = ["id", "issue", "priority", "opened", "blocking"]
ROWS = [
    [1, "Parser drops inline strings", "P0", datetime.date(2026, 9, 1), True],
    [2, "Empty cell shifts columns", None, datetime.date(2026, 9, 2), False],
    [7, "Totals row counted twice", "P2", datetime.date(2026, 9, 7), False],
]
PARAGRAPHS = [
    "Quarterly review of the reading pipeline.",
    "Every sheet, paragraph and slide must reach the text.",
    "Owner: the platform team.",
]
SLIDES = [("Reading pipeline", "Every cell reaches the text."), ("Next steps", "Add writers to the corpus.")]


def openpyxl_workbook(path):
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Bugs"
    sheet.append(HEADER)
    for row in ROWS:
        sheet.append(row)
    sheet.freeze_panes = "A2"
    second = book.create_sheet("Notes")
    second.append(["note"])
    second.append(["A second sheet is named in the text."])
    book.save(path)


# The agent-shaped workbook: the shape an agent writes through openpyxl (inline strings, a bold frozen header row, set
# column widths, an autofilter, blank cells as empty strings), which a reader once read as its sheet names alone.
# Its content is invented: the stock list of a fictional bicycle shop.
STOCK_HEADER = ["id", "item", "aisle", "section", "count_jan", "count_feb", "count_mar", "notes"]
STOCK_ROWS = [
    ["Gravel tyre 700x40, tan wall", "A1", "tyres", "Counted", "Counted", "Short", ""],
    ["Inner tube 29in, presta", "A1", "tyres", "", "Short", "Counted", "Reordered from the usual wholesaler"],
    ["Brake pads, resin, disc", "A2", "brakes", "Counted", "Counted", "Counted", "two packs found under the bench"],
    ["Chain, 11-speed", "A2", "drivetrain", "Short", "Short", "Short", "Waiting on the spring delivery"],
    ["Cassette 11-34", "A3", "drivetrain", "Counted", "Short", "Counted", "Moved to the locked cabinet"],
    ["Bar tape, cork, black", "B1", "cockpit", "Counted", "Counted", "Counted", ""],
    ["Bottle cage, alloy", "B1", "accessories", "Counted", "Counted", "Short", "Shelf label says 12, counted 9"],
    ["Front light, 800 lumen", "B2", "lights", "Counted", "Short", "Counted", ""],
    ["Rear light, USB", "B2", "lights", "Counted", "Counted", "Counted", ""],
    ["Saddle bag, small", "B3", "bags", "Short", "Counted", "Counted", ""],
    ["Mudguard set, 700c", "C1", "accessories", "Counted", "Counted", "Short", ""],
    ["Pedals, flat, composite", "C1", "pedals", "", "Counted", "Counted", "Display pair not for sale"],
    ["Grease, 100 g", "C2", "workshop", "", "Short", "Counted", ""],
    ["Cable cutters", "C2", "workshop", "", "Counted", "Counted", ""],
    ["Spoke key set", "C3", "workshop", "", "Counted", "Short", ""],
    ["Kickstand, rear mount", "C3", "accessories", "", "", "Counted", "Arrived 3 March, count 6"],
    ["Basket, wicker, front", "D1", "bags", "", "", "Counted", ""],
    ["Bell, brass", "D1", "accessories", "", "", "Short", "Customer order put aside"],
]
STOCK_WIDTHS = {"A": 5, "B": 48, "C": 9, "D": 11, "E": 10, "F": 10, "G": 13, "H": 40}


def agent_shaped_workbook(path):
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.title = "Stock"
    sheet.append(STOCK_HEADER)
    for cell in sheet[1]:
        cell.font = openpyxl.styles.Font(bold=True)
    for i, row in enumerate(STOCK_ROWS, start=1):
        sheet.append([i, *row])
    sheet.freeze_panes = "A2"
    for col, width in STOCK_WIDTHS.items():
        sheet.column_dimensions[col].width = width
    sheet.auto_filter.ref = f"A1:H{len(STOCK_ROWS) + 1}"
    book.save(path)


def xlsxwriter_workbook(path):
    book = xlsxwriter.Workbook(path)
    sheet = book.add_worksheet("Bugs")
    dates = book.add_format({"num_format": "yyyy-mm-dd"})
    sheet.write_row(0, 0, HEADER)
    for r, row in enumerate(ROWS, start=1):
        for c, value in enumerate(row):
            if value is None:
                continue
            if isinstance(value, datetime.date):
                sheet.write_datetime(r, c, datetime.datetime.combine(value, datetime.time()), dates)
            else:
                sheet.write(r, c, value)
    second = book.add_worksheet("Notes")
    second.write_row(0, 0, ["note"])
    second.write_row(1, 0, ["A second sheet is named in the text."])
    book.close()


def python_docx_document(path):
    document = docx.Document()
    document.add_heading("Reading pipeline", level=1)
    for text in PARAGRAPHS:
        document.add_paragraph(text)
    table = document.add_table(rows=1, cols=len(HEADER))
    for cell, text in zip(table.rows[0].cells, HEADER):
        cell.text = text
    for row in ROWS:
        cells = table.add_row().cells
        for cell, value in zip(cells, row):
            cell.text = "" if value is None else str(value)
    document.save(path)


def python_pptx_deck(path):
    deck = pptx.Presentation()
    for title, body in SLIDES:
        slide = deck.slides.add_slide(deck.slide_layouts[1])
        slide.shapes.title.text = title
        slide.placeholders[1].text = body
    deck.save(path)


def icalendar_calendar(path):
    # Imported here: a producer is needed only when its file is made.
    import icalendar

    cal = icalendar.Calendar()
    cal.add("prodid", "-//Engine writer corpus//icalendar//EN")
    cal.add("version", "2.0")
    cal.add("method", "REQUEST")
    event = icalendar.Event()
    event.add("uid", "writer-corpus-1@example.test")
    event.add("dtstamp", datetime.datetime(2026, 9, 30, 9, 0, tzinfo=datetime.timezone.utc))
    event.add("dtstart", datetime.datetime(2026, 10, 1, 9, 0, tzinfo=datetime.timezone.utc))
    event.add("dtend", datetime.datetime(2026, 10, 1, 10, 0, tzinfo=datetime.timezone.utc))
    event.add("rrule", {"freq": "weekly", "byday": "TH"})
    event.add("summary", "Reading pipeline review, Q4")
    event.add("location", "Room 3; the long table")
    organizer = icalendar.vCalAddress("mailto:owner@example.test")
    organizer.params["cn"] = "Platform Owner"
    event.add("organizer", organizer)
    attendee = icalendar.vCalAddress("mailto:reader@example.test")
    attendee.params["cn"] = "Reader"
    event.add("attendee", attendee)
    event.add("description", "\n".join(PARAGRAPHS) + " " + "A long line that the writer folds. " * 4)
    cal.add_component(event)
    with open(path, "wb") as out:
        out.write(cal.to_ical())


def python_email_message(path):
    # The standard library's own writer: a mail as Python's `email` package serialises it.
    from email.message import EmailMessage
    from email.utils import format_datetime

    msg = EmailMessage()
    msg["From"] = "Platform Owner <owner@example.test>"
    msg["To"] = "Reader <reader@example.test>, second@example.test"
    msg["Subject"] = "Reading pipeline review’s notes"
    msg["Date"] = format_datetime(datetime.datetime(2026, 9, 30, 9, 0, tzinfo=datetime.timezone(datetime.timedelta(hours=13))))
    msg["Message-ID"] = "<writer-corpus-1@example.test>"
    msg.set_content("\n".join(PARAGRAPHS))
    msg.add_alternative("<p>" + "</p><p>".join(PARAGRAPHS) + "</p>", subtype="html")
    msg.add_attachment(b"id,issue\n1,Parser drops inline strings\n", maintype="text", subtype="csv", filename="bugs.csv")
    with open(path, "wb") as out:
        out.write(bytes(msg))


# A call's transcript as Teams writes one (a voice tag per cue) and the same cues as SubRip, both through webvtt-py.
CUES = [
    ("00:00:16.246", "00:00:19.100", "Platform Owner", "Thanks for joining. Let’s start with the reading pipeline."),
    ("00:00:19.300", "00:00:22.000", "Platform Owner", "Every sheet &amp; slide must reach the text."),
    ("00:01:02.500", "00:01:06.000", "Second Reader", "I’ll add the writers to the corpus by Friday."),
]


def webvtt_transcript(vtt_path, srt_path):
    import webvtt

    captions = webvtt.WebVTT()
    for start, end, speaker, text in CUES:
        captions.captions.append(webvtt.Caption(start, end, [f"<v {speaker}>{text}</v>"]))
    captions.save(vtt_path)
    # SubRip has no voice tag; the speaker rides in the text, as Zoom writes it.
    plain = webvtt.WebVTT()
    for start, end, speaker, text in CUES:
        plain.captions.append(webvtt.Caption(start, end, [f"{speaker}: {text.replace('&amp;', '&')}"]))
    plain.save_as_srt(srt_path)


PRODUCERS = {
    "openpyxl": lambda: openpyxl_workbook("openpyxl.xlsx"),
    "xlsxwriter": lambda: xlsxwriter_workbook("xlsxwriter.xlsx"),
    "python-docx": lambda: python_docx_document("python-docx.docx"),
    "python-pptx": lambda: python_pptx_deck("python-pptx.pptx"),
    "icalendar": lambda: icalendar_calendar("icalendar.ics"),
    "python-email": lambda: python_email_message("python-email.eml"),
    "webvtt-py": lambda: webvtt_transcript("webvtt-py.vtt", "webvtt-py.srt"),
    "agent-shaped": lambda: agent_shaped_workbook("openpyxl-shop-stock.xlsx"),
}


AGENT_SHAPED_ENTRY = {
    "producer": "openpyxl, in the shape an agent writes",
    "version": openpyxl.__version__,
    "note": "invented content (a fictional bicycle shop's stock list) in the shape of a workbook once read as its sheet "
    "names alone: inline strings, a frozen bold header row, set column widths, an autofilter, blank cells",
}


def manifest_entries(names):
    entries = {}
    if "openpyxl" in names:
        entries["openpyxl.xlsx"] = {"producer": "openpyxl", "version": openpyxl.__version__}
    if "xlsxwriter" in names:
        entries["xlsxwriter.xlsx"] = {"producer": "xlsxwriter", "version": xlsxwriter.__version__}
    if "python-docx" in names:
        entries["python-docx.docx"] = {"producer": "python-docx", "version": getattr(docx, "__version__", "")}
    if "python-pptx" in names:
        entries["python-pptx.pptx"] = {"producer": "python-pptx", "version": pptx.__version__}
    if "icalendar" in names:
        import icalendar

        entries["icalendar.ics"] = {"producer": "icalendar", "version": icalendar.__version__}
    if "python-email" in names:
        entries["python-email.eml"] = {"producer": "python email (stdlib)", "version": sys.version.split()[0]}
    if "webvtt-py" in names:
        import webvtt

        for name in ("webvtt-py.vtt", "webvtt-py.srt"):
            entries[name] = {"producer": "webvtt-py", "version": webvtt.__version__}
    if "agent-shaped" in names:
        entries["openpyxl-shop-stock.xlsx"] = AGENT_SHAPED_ENTRY
    return entries


if __name__ == "__main__" and len(sys.argv) > 1:
    # Only the producers named: the other files, and their goldens, are left exactly as they are.
    names = sys.argv[1:]
    for name in names:
        PRODUCERS[name]()
    with open("manifest.json") as current:
        manifest = json.load(current)
    manifest.update(manifest_entries(names))
    with open("manifest.json", "w") as out:
        json.dump(manifest, out, indent=2)
        out.write("\n")
    sys.exit(0)

if __name__ == "__main__":
    openpyxl_workbook("openpyxl.xlsx")
    xlsxwriter_workbook("xlsxwriter.xlsx")
    python_docx_document("python-docx.docx")
    python_pptx_deck("python-pptx.pptx")
    agent_shaped_workbook("openpyxl-shop-stock.xlsx")
    with open("manifest.json", "w") as out:
        json.dump(
            {
                "openpyxl.xlsx": {"producer": "openpyxl", "version": openpyxl.__version__},
                "xlsxwriter.xlsx": {"producer": "xlsxwriter", "version": xlsxwriter.__version__},
                "python-docx.docx": {"producer": "python-docx", "version": getattr(docx, "__version__", "")},
                "python-pptx.pptx": {"producer": "python-pptx", "version": pptx.__version__},
                "openpyxl-shop-stock.xlsx": AGENT_SHAPED_ENTRY,
            },
            out,
            indent=2,
        )
        out.write("\n")
