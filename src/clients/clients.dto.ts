export class CreateClientDto {
  name: string;
  phone?: string;
  note?: string;
}

export class UpdateClientDto {
  name?: string;
  phone?: string;
  note?: string;
}