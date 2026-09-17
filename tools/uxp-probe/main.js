const ps = require('photoshop');
const uxp = require('uxp');

async function inspectHost() {
  const report = {
    schemaVersion: 1,
    runtime: 'UXP-plugin',
    photoshopVersion: ps.app.version,
    openDocumentCount: ps.app.documents.length,
    imagingGetPixels: typeof ps.imaging?.getPixels,
    imagingPutPixels: typeof ps.imaging?.putPixels,
    createImageDataFromBuffer: typeof ps.imaging?.createImageDataFromBuffer,
    executeAsModal: typeof ps.core.executeAsModal,
    recordedAt: new Date().toISOString(),
    documentMutations: 0
  };
  report.requiredApisPresent = [
    report.imagingGetPixels, report.imagingPutPixels,
    report.createImageDataFromBuffer, report.executeAsModal
  ].every(value => value === 'function');
  const target = document.getElementById('report');
  target.textContent = JSON.stringify(report, null, 2);
  try {
    const folder = await uxp.storage.localFileSystem.getDataFolder();
    const file = await folder.createFile('host-probe.json', { overwrite: true });
    await file.write(JSON.stringify(report, null, 2));
    target.textContent += '\n\n报告保存在本插件的数据目录。';
  } catch (error) {
    target.textContent += '\n\n报告保存失败：' + String(error.message || error);
  }
  return report;
}

document.getElementById('inspect').addEventListener('click', () => {
  inspectHost().catch(error => {
    document.getElementById('report').textContent = String(error.message || error);
  });
});
inspectHost().catch(error => {
  document.getElementById('report').textContent = String(error.message || error);
});
