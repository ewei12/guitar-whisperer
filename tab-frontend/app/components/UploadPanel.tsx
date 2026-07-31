export function UploadPanel({
  file,
  loading,
  isDragging,
  onFileChange,
  onSubmit,
}: {
  file: File | null;
  loading: boolean;
  isDragging: boolean;
  onFileChange: (file: File) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mx-auto mb-10" style={{ maxWidth: "750px" }}>
      <div
        className="p-6"
        style={{
          background: "#fffbf7",
          border: "3px solid #111",
          boxShadow: "6px 6px 0 #111",
        }}
      >
        <label
          className="flex items-center justify-center gap-5 py-6 px-5 rounded-lg cursor-pointer 
          transition-colors duration-200 hover:bg-[#f6ece5] min-h-[120px]"
          style={{
            border: isDragging ? "2px dashed #D94827" : "1px dashed #c69c7e",
            background: isDragging ? "#f6ece5" : undefined,
          }}
        >
          <img
            className="rounded-lg transition-transform duration-200 group-hover:scale-110"
            src="/upload.svg"
            alt="Upload"
            width={52}
            height={52}
          />
          <div className="min-w-0">
            <p className="text-xl truncate" style={{ color: "#3A2A1C" }}>
              {file ? file.name : "pick an audio file"}
            </p>
            <p className="handwrite text-xs italic" style={{ color: "#9A8567" }}>
              {file ? "" : "wav, mp3, m4a, mp4"}
            </p>
          </div>
          <input
            type="file"
            accept="audio/*"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) onFileChange(picked);
            }}
            className="hidden"
          />
        </label>

        <button
          onClick={onSubmit}
          disabled={!file || loading}
          className="w-full mt-6 py-4 text-lg font-bold uppercase rounded-lg transition-all duration-150"
          style={{
            background: !file ? "#3A3A38" : "#111",
            color: !file ? "#8A8A85" : "#fff",
            border: !file ? "2px solid #3A3A38" : "2px solid #111",
            boxShadow: !file ? "4px 4px 0 #D8CFC0" : "4px 4px 0 #C9A15E",
            cursor: !file || loading ? "not-allowed" : "pointer",
            fontFamily: "var(--font-stack-notch)",
            letterSpacing: "0.08em",
            transform: "translate(0, 0)",
          }}
          onMouseEnter={(e) => {
            if (file && !loading) {
              e.currentTarget.style.transform = "translate(-2px, -2px)";
              e.currentTarget.style.boxShadow = "6px 6px 0 #C9A15E";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translate(0, 0)";
            e.currentTarget.style.boxShadow = file ? "6px 6px 0 #C9A15E" : "4px 4px 0 #D8CFC0";
          }}
          onMouseDown={(e) => {
            if (file && !loading) {
              e.currentTarget.style.transform = "translate(4px, 4px)";
              e.currentTarget.style.boxShadow = "0px 0px 0 #C9A15E";
            }
          }}
          onMouseUp={(e) => {
            if (file && !loading) {
              e.currentTarget.style.transform = "translate(-2px, -2px)";
              e.currentTarget.style.boxShadow = "6px 6px 0 #bc8057";
            }
          }}
        >
          <span
            className="inline-flex items-center justify-center gap-2.5"
            style={{ animation: loading ? "pulse 1.2s ease-in-out infinite" : undefined }}
          >
            {loading && (
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />
            )}
            <span>{loading ? "listening" : "create tab"}</span>
          </span>
        </button>

        <style>{`
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50%      { transform: scale(1); opacity: 0.3; }
  }
`}</style>
      </div>
    </div>
  );
}