import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle, FileText, Upload } from "lucide-react";

import { trpc } from "@/utils/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

// Plain interface matching the tRPC parse mutation output (dates as strings, not Date objects)
export interface ParseResult {
  workouts: Array<{
    date: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    exercises: any[];
    isRestDay: boolean;
    rawText: string;
  }>;
  uniqueExerciseNames: string[];
  parseWarnings: Array<{ date: string; line: string; message: string }>;
}

interface UploadStepProps {
  onComplete: (parseResult: ParseResult) => void;
}

export function UploadStep({ onComplete }: UploadStepProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [showWarnings, setShowWarnings] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseMutation = useMutation(trpc.import.parse.mutationOptions());

  const processFile = (file: File) => {
    if (!file.name.endsWith(".md") && !file.name.endsWith(".txt")) {
      alert("Please upload a Markdown (.md) or text (.txt) file.");
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setParseResult(null);

    const reader = new FileReader();
    reader.onload = (e) => {
      const markdown = e.target?.result as string;
      parseMutation.mutate(
        { markdown },
        {
          onSuccess: (result) => {
            setParseResult(result);
          },
        },
      );
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const workoutCount = parseResult
    ? parseResult.workouts.filter((w) => !w.isRestDay).length
    : 0;
  const restDayCount = parseResult
    ? parseResult.workouts.filter((w) => w.isRestDay).length
    : 0;

  const fileSizeKb = fileSize ? Math.round(fileSize / 1024) : null;
  const isLargeFile = fileSize ? fileSize > 200_000 : false;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Upload Workout Log</h2>
        <p className="text-muted-foreground text-sm">
          Upload your markdown workout log file to begin the import process.
        </p>
      </div>

      {/* Drop zone */}
      <div
        className={[
          "border-2 border-dashed rounded-none p-12 text-center cursor-pointer transition-colors",
          isDragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-primary/50 hover:bg-muted/30",
        ].join(" ")}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.txt"
          className="hidden"
          onChange={handleFileChange}
        />
        <Upload className="mx-auto mb-3 size-10 text-muted-foreground" />
        <p className="text-sm font-medium">
          Drop your .md file here or click to browse
        </p>
        <p className="text-muted-foreground mt-1 text-xs">
          Accepts .md and .txt files up to ~500KB
        </p>
      </div>

      {/* File info */}
      {fileName && (
        <div className="flex items-center gap-2 text-sm">
          <FileText className="size-4 text-muted-foreground" />
          <span className="font-medium">{fileName}</span>
          {fileSizeKb !== null && (
            <span className="text-muted-foreground">({fileSizeKb} KB)</span>
          )}
          {isLargeFile && (
            <Badge variant="outline" className="text-yellow-600">
              Large file
            </Badge>
          )}
        </div>
      )}

      {/* Parse loading */}
      {parseMutation.isPending && (
        <Card>
          <CardContent className="py-4">
            <p className="text-muted-foreground text-sm">Parsing file...</p>
          </CardContent>
        </Card>
      )}

      {/* Parse error */}
      {parseMutation.isError && (
        <Card className="border-destructive">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="size-4" />
              <p className="text-sm">
                {parseMutation.error instanceof Error
                  ? parseMutation.error.message
                  : "Failed to parse file"}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Parse result summary */}
      {parseResult && !parseMutation.isPending && (
        <Card>
          <CardContent className="py-4 space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="text-sm">
                <span className="font-semibold">{workoutCount}</span>{" "}
                <span className="text-muted-foreground">workouts found</span>
              </div>
              <div className="text-sm">
                <span className="font-semibold">{restDayCount}</span>{" "}
                <span className="text-muted-foreground">rest days</span>
              </div>
              <div className="text-sm">
                <span className="font-semibold">
                  {parseResult.uniqueExerciseNames.length}
                </span>{" "}
                <span className="text-muted-foreground">unique exercises</span>
              </div>
            </div>

            {parseResult.parseWarnings.length > 0 && (
              <div>
                <button
                  className="text-xs text-yellow-600 underline underline-offset-2"
                  onClick={() => setShowWarnings(!showWarnings)}
                >
                  {parseResult.parseWarnings.length} parse warning
                  {parseResult.parseWarnings.length > 1 ? "s" : ""} (
                  {showWarnings ? "hide" : "show"})
                </button>
                {showWarnings && (
                  <ul className="mt-2 space-y-1">
                    {parseResult.parseWarnings.map((w, i) => (
                      <li key={i} className="text-xs text-muted-foreground">
                        <span className="font-mono">{w.date}</span>:{" "}
                        {w.message}
                        {w.line && (
                          <span className="text-muted-foreground/60">
                            {" "}
                            — "{w.line}"
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Next button */}
      <div className="flex justify-end">
        <Button
          disabled={!parseResult || parseMutation.isPending || workoutCount === 0}
          onClick={() => {
            if (parseResult) {
              onComplete(parseResult);
            }
          }}
        >
          Next: Resolve Exercises
        </Button>
      </div>
    </div>
  );
}
