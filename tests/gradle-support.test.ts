import { describe, expect, it } from "vitest";
import { chooseGradleScript, decodeProcessText, gradleBuildTasks, gradleLockedCleanDirectories, parseGradleDistributionProperties, windowsBatchCommand } from "../electron/gradle-support.js";

describe("Gradle build support", () => {
  it("uses a matching cached distribution when the wrapper JAR is missing", () => {
    expect(chooseGradleScript({ wrapper: "C:/project/gradlew.bat", wrapperJarExists: false, cached: "C:/cache/gradle-8.7/bin/gradle.bat" })).toEqual({ script: "C:/cache/gradle-8.7/bin/gradle.bat", source: "cache" });
  });

  it("prefers a complete wrapper", () => {
    expect(chooseGradleScript({ wrapper: "C:/project/gradlew.bat", wrapperJarExists: true, cached: "C:/cache/gradle.bat" })).toEqual({ script: "C:/project/gradlew.bat", source: "wrapper" });
  });

  it("parses escaped Gradle distribution URLs", () => {
    expect(parseGradleDistributionProperties("distributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip\n")).toEqual({ distribution: "gradle-8.7-bin", versionDirectory: "gradle-8.7" });
  });

  it("falls back to GB18030 for Windows Java output", () => {
    expect(decodeProcessText(Buffer.from([0xb4, 0xed, 0xce, 0xf3]))).toBe("错误");
  });

  it("wraps a Windows batch path for cmd /s /c without escaped quote literals", () => {
    expect(windowsBatchCommand("C:\\Users\\Test User\\.gradle\\gradle.bat", ["assembleDebug"])).toBe('""C:\\Users\\Test User\\.gradle\\gradle.bat" assembleDebug"');
  });

  it("uses clean before assembleDebug for a full rebuild", () => {
    expect(gradleBuildTasks(false)).toEqual(["assembleDebug"]);
    expect(gradleBuildTasks(true)).toEqual(["--no-daemon", "clean", "assembleDebug"]);
  });

  it("extracts Windows output directories that Gradle cleaned but could not remove", () => {
    expect(gradleLockedCleanDirectories("java.io.IOException: Unable to delete directory 'D:\\project\\app\\build'")).toEqual(["D:\\project\\app\\build"]);
  });
});
