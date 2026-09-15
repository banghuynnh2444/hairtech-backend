export class CreateDiagramDto {
  clientId: string;
  title: string;
  data: Record<string, any>; // Lưu trữ ma trận 3D, tọa độ uốn tóc, góc cắt
}

export class UpdateDiagramDto {
  title?: string;
  data?: Record<string, any>;
}